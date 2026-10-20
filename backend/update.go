package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	updateRepo                   = "dolphinZzv/mysqlUI"
	defaultUpdateIntervalMinutes = 10
	maxUpdateFileSize            = 200 << 20 // 200 MiB
)

var updateHTTPClient = &http.Client{Timeout: 60 * time.Second}

type updateSettings struct {
	Enabled         bool `json:"enabled"`
	IntervalMinutes int  `json:"intervalMinutes"`
}

type updateStatus struct {
	CurrentVersion   string `json:"currentVersion"`
	LatestVersion    string `json:"latestVersion,omitempty"`
	UpdateAvailable  bool   `json:"updateAvailable"`
	Enabled          bool   `json:"enabled"`
	IntervalMinutes  int    `json:"intervalMinutes"`
	LastChecked      string `json:"lastChecked,omitempty"`
	LastError        string `json:"lastError,omitempty"`
	InstalledVersion string `json:"installedVersion,omitempty"`
	RestartRequired  bool   `json:"restartRequired"`
	CanRestart       bool   `json:"canRestart"`
	ReleaseURL       string `json:"releaseUrl,omitempty"`
	DevBuild         bool   `json:"devBuild"`
}

type releaseAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}

type releaseInfo struct {
	TagName string         `json:"tag_name"`
	HTMLURL string         `json:"html_url"`
	Assets  []releaseAsset `json:"assets"`
}

type updateManager struct {
	mu    sync.Mutex
	opMu  sync.Mutex
	path  string
	saved updateSettings

	latest          *releaseInfo
	lastChecked     time.Time
	lastErr         string
	installed       string
	restartRequired bool
}

func newUpdateManager(dir string) *updateManager {
	m := &updateManager{
		path:  filepath.Join(dir, "updates.json"),
		saved: updateSettings{Enabled: true, IntervalMinutes: defaultUpdateIntervalMinutes},
	}
	if data, err := os.ReadFile(m.path); err == nil {
		_ = json.Unmarshal(data, &m.saved)
	}
	m.saved = normalizeUpdateSettings(m.saved)
	return m
}

func normalizeUpdateSettings(s updateSettings) updateSettings {
	if s.IntervalMinutes <= 0 {
		s.IntervalMinutes = defaultUpdateIntervalMinutes
	}
	if s.IntervalMinutes < 1 {
		s.IntervalMinutes = 1
	}
	if s.IntervalMinutes > 24*60 {
		s.IntervalMinutes = 24 * 60
	}
	return s
}

func (m *updateManager) status() updateStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := updateStatus{
		CurrentVersion:   version,
		Enabled:          m.saved.Enabled,
		IntervalMinutes:  m.saved.IntervalMinutes,
		LastError:        m.lastErr,
		InstalledVersion: m.installed,
		RestartRequired:  m.restartRequired,
		CanRestart:       canRestartProcess(),
		DevBuild:         version == "dev",
	}
	if !m.lastChecked.IsZero() {
		st.LastChecked = m.lastChecked.Format(time.RFC3339)
	}
	if m.latest != nil {
		st.LatestVersion = m.latest.TagName
		st.ReleaseURL = m.latest.HTMLURL
		st.UpdateAvailable = updateAvailableLocked(m.latest, m.installed)
	}
	return st
}

func updateAvailableLocked(rel *releaseInfo, installed string) bool {
	if rel == nil || version == "dev" {
		return false
	}
	if installed != "" && !versionNewer(rel.TagName, installed) {
		return false
	}
	return versionNewer(rel.TagName, version)
}

func (m *updateManager) configure(enabled bool, intervalMinutes int) error {
	s := normalizeUpdateSettings(updateSettings{Enabled: enabled, IntervalMinutes: intervalMinutes})
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if dir := filepath.Dir(m.path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	tmp := m.path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, m.path); err != nil {
		return err
	}
	m.mu.Lock()
	m.saved = s
	m.mu.Unlock()
	return nil
}

func (m *updateManager) check(ctx context.Context) error {
	m.opMu.Lock()
	defer m.opMu.Unlock()
	return m.checkLocked(ctx)
}

func (m *updateManager) checkLocked(ctx context.Context) error {
	rel, err := fetchLatestRelease(ctx)
	m.mu.Lock()
	m.lastChecked = time.Now()
	if err != nil {
		m.lastErr = err.Error()
		m.mu.Unlock()
		return err
	}
	m.latest = rel
	m.lastErr = ""
	m.mu.Unlock()
	return nil
}

func (m *updateManager) apply(ctx context.Context) (string, error) {
	m.opMu.Lock()
	defer m.opMu.Unlock()

	m.mu.Lock()
	rel := m.latest
	m.mu.Unlock()
	if rel == nil {
		if err := m.checkLocked(ctx); err != nil {
			return "", err
		}
		m.mu.Lock()
		rel = m.latest
		m.mu.Unlock()
	}
	if rel == nil {
		return "", errors.New("no release information available")
	}

	tag, err := installRelease(ctx, rel)
	m.mu.Lock()
	if err != nil {
		m.lastErr = err.Error()
	} else {
		m.lastErr = ""
		m.installed = tag
		m.restartRequired = true
	}
	m.mu.Unlock()
	return tag, err
}

func (m *updateManager) interval() time.Duration {
	m.mu.Lock()
	defer m.mu.Unlock()
	return time.Duration(m.saved.IntervalMinutes) * time.Minute
}

func (m *updateManager) run(ctx context.Context) {
	for {
		timer := time.NewTimer(m.interval())
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			m.autoUpdate(ctx)
		}
	}
}

func (m *updateManager) autoUpdate(ctx context.Context) {
	if version == "dev" {
		return
	}
	m.mu.Lock()
	enabled := m.saved.Enabled
	installed := m.installed
	restartRequired := m.restartRequired
	m.mu.Unlock()
	if !enabled {
		return
	}

	// If a previous run already replaced the binary but the restart failed,
	// try restarting without downloading the same release again.
	if installed != "" && restartRequired {
		m.mu.Lock()
		rel := m.latest
		m.mu.Unlock()
		if rel != nil && !versionNewer(rel.TagName, installed) {
			if err := restartProcess(); err == nil {
				return
			}
			return
		}
	}

	if err := m.check(ctx); err != nil {
		log.Printf("auto-update check failed: %v", err)
		return
	}
	m.mu.Lock()
	rel := m.latest
	available := rel != nil && updateAvailableLocked(rel, installed)
	m.mu.Unlock()
	if !available {
		return
	}

	log.Printf("auto-update: installing %s", rel.TagName)
	tag, err := m.apply(ctx)
	if err != nil {
		log.Printf("auto-update failed: %v", err)
		return
	}
	log.Printf("auto-update: installed %s, restarting", tag)
	if err := restartProcess(); err != nil {
		log.Printf("auto-update: restart failed: %v (restart mysqlui manually)", err)
	}
}

func fetchLatestRelease(ctx context.Context) (*releaseInfo, error) {
	return fetchRelease(ctx, "")
}

func fetchRelease(ctx context.Context, tag string) (*releaseInfo, error) {
	endpoint := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", updateRepo)
	if tag != "" {
		endpoint = fmt.Sprintf("https://api.github.com/repos/%s/releases/tags/%s", updateRepo, url.PathEscape(tag))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "mysqlui-updater")
	if token := strings.TrimSpace(os.Getenv("GITHUB_TOKEN")); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := updateHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		return nil, fmt.Errorf("github returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	var rel releaseInfo
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&rel); err != nil {
		return nil, err
	}
	if rel.TagName == "" {
		return nil, errors.New("release has no tag name")
	}
	return &rel, nil
}

func updateAssetName() string {
	name := fmt.Sprintf("mysqlui-%s-%s", runtime.GOOS, runtime.GOARCH)
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return name
}

func installRelease(ctx context.Context, rel *releaseInfo) (string, error) {
	assetName := updateAssetName()
	var asset *releaseAsset
	for i := range rel.Assets {
		if rel.Assets[i].Name == assetName {
			asset = &rel.Assets[i]
			break
		}
	}
	if asset == nil {
		return "", fmt.Errorf("release %s has no asset %q", rel.TagName, assetName)
	}

	expected, err := fetchChecksum(ctx, rel, assetName)
	if err != nil {
		return "", err
	}

	exe := executablePath()
	dir := filepath.Dir(exe)
	tmp, err := os.CreateTemp(dir, ".mysqlui-update-")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
	}()

	resp, err := updateHTTPClient.Get(asset.URL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download failed: %s", resp.Status)
	}

	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, h), io.LimitReader(resp.Body, maxUpdateFileSize+1))
	if err != nil {
		return "", err
	}
	if n > maxUpdateFileSize {
		return "", fmt.Errorf("update asset %s is too large", assetName)
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	actual := hex.EncodeToString(h.Sum(nil))
	if !strings.EqualFold(actual, expected) {
		return "", fmt.Errorf("checksum mismatch for %s", assetName)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(tmpName, 0o755); err != nil {
			return "", err
		}
	}
	if err := replaceExecutable(exe, tmpName); err != nil {
		return "", err
	}
	return rel.TagName, nil
}

func fetchChecksum(ctx context.Context, rel *releaseInfo, assetName string) (string, error) {
	var checksums *releaseAsset
	for i := range rel.Assets {
		if rel.Assets[i].Name == "checksums.txt" {
			checksums = &rel.Assets[i]
			break
		}
	}
	if checksums == nil {
		return "", fmt.Errorf("release %s has no checksums.txt", rel.TagName)
	}
	resp, err := updateHTTPClient.Get(checksums.URL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("checksums download failed: %s", resp.Status)
	}
	scanner := bufio.NewScanner(io.LimitReader(resp.Body, 4<<20))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		name := strings.TrimPrefix(fields[1], "*")
		if name == assetName {
			return strings.ToLower(fields[0]), nil
		}
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return "", fmt.Errorf("checksum for %s not found", assetName)
}

func parseVersion(v string) ([]int, bool) {
	v = strings.TrimSpace(strings.TrimPrefix(strings.ToLower(v), "v"))
	if v == "" || v == "dev" {
		return nil, false
	}
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	nums := make([]int, len(parts))
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return nil, false
		}
		nums[i] = n
	}
	return nums, true
}

func versionNewer(latest, current string) bool {
	l, ok := parseVersion(latest)
	if !ok {
		return false
	}
	c, ok := parseVersion(current)
	if !ok {
		return false
	}
	for i := 0; i < len(l) || i < len(c); i++ {
		var a, b int
		if i < len(l) {
			a = l[i]
		}
		if i < len(c) {
			b = c[i]
		}
		if a != b {
			return a > b
		}
	}
	return false
}

func runUpdateCommand(args []string) {
	checkOnly := false
	force := false
	tag := ""
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--check":
			checkOnly = true
		case "--force":
			force = true
		case "--version":
			if i+1 >= len(args) {
				fatal(errors.New("--version requires a release tag, e.g. --version v0.6.0"))
			}
			tag = args[i+1]
			i++
		case "help", "--help", "-h":
			fmt.Println("usage: mysqlui update [--check] [--force] [--version vX.Y.Z]")
			return
		default:
			fatal(fmt.Errorf("unknown update option %q", args[i]))
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	rel, err := fetchRelease(ctx, tag)
	if err != nil {
		fatal(err)
	}
	fmt.Printf("current: %s\nlatest:  %s\n", version, rel.TagName)
	if checkOnly {
		return
	}
	if !force && version != "dev" && !versionNewer(rel.TagName, version) {
		fmt.Println("already up to date")
		return
	}
	installed, err := installRelease(ctx, rel)
	if err != nil {
		fatal(err)
	}
	fmt.Printf("updated to %s (%s)\n", installed, executablePath())
	if pid, err := readPID(); err == nil && processAlive(pid) {
		fmt.Println("restart the running instance with: mysqlui restart")
	}
}

// ---- HTTP handlers ------------------------------------------------------

func (s *Server) updateStatusHandler(w http.ResponseWriter, r *http.Request) {
	if s.updates == nil {
		writeErr(w, http.StatusServiceUnavailable, errors.New("update manager is unavailable"))
		return
	}
	writeJSON(w, http.StatusOK, s.updates.status())
}

func (s *Server) updateSettingsHandler(w http.ResponseWriter, r *http.Request) {
	if s.updates == nil {
		writeErr(w, http.StatusServiceUnavailable, errors.New("update manager is unavailable"))
		return
	}
	var in struct {
		Enabled         bool `json:"enabled"`
		IntervalMinutes int  `json:"intervalMinutes"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := s.updates.configure(in.Enabled, in.IntervalMinutes); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, s.updates.status())
}

func (s *Server) updateCheckHandler(w http.ResponseWriter, r *http.Request) {
	if s.updates == nil {
		writeErr(w, http.StatusServiceUnavailable, errors.New("update manager is unavailable"))
		return
	}
	if err := s.updates.check(r.Context()); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, s.updates.status())
}

func (s *Server) updateApplyHandler(w http.ResponseWriter, r *http.Request) {
	if s.updates == nil {
		writeErr(w, http.StatusServiceUnavailable, errors.New("update manager is unavailable"))
		return
	}
	tag, err := s.updates.apply(r.Context())
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"installed":       tag,
		"restartRequired": true,
		"canRestart":      canRestartProcess(),
	})
}

func (s *Server) updateRestartHandler(w http.ResponseWriter, r *http.Request) {
	if s.updates == nil {
		writeErr(w, http.StatusServiceUnavailable, errors.New("update manager is unavailable"))
		return
	}
	if !canRestartProcess() {
		writeErr(w, http.StatusNotImplemented, errors.New("automatic restart is not supported on this platform; restart mysqlui manually"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	go func() {
		time.Sleep(300 * time.Millisecond)
		if err := restartProcess(); err != nil {
			log.Printf("restart failed: %v", err)
		}
	}()
}
