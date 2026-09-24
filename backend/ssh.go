package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-sql-driver/mysql"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// SSHConfig describes an optional SSH jump host used to reach the MySQL server.
type SSHConfig struct {
	Enabled       bool   `json:"enabled"`
	Host          string `json:"host"`
	Port          int    `json:"port"`
	User          string `json:"user"`
	AuthMethod    string `json:"authMethod"` // "password" or "key"
	Password      string `json:"password,omitempty"`
	PrivateKey    string `json:"privateKey,omitempty"` // PEM contents
	Passphrase    string `json:"passphrase,omitempty"`
	IgnoreHostKey bool   `json:"ignoreHostKey"`
}

// sshTunnel lazily establishes and caches a single SSH client per connection.
type sshTunnel struct {
	mu      sync.Mutex
	client  *ssh.Client
	network string
}

func (t *sshTunnel) Close() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.client != nil {
		_ = t.client.Close()
		t.client = nil
	}
}

func hostKeyCallback(ignore bool) (ssh.HostKeyCallback, error) {
	if ignore {
		return ssh.InsecureIgnoreHostKey(), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("cannot locate home directory for known_hosts: %w", err)
	}
	path := filepath.Join(home, ".ssh", "known_hosts")
	cb, err := knownhosts.New(path)
	if err != nil {
		return nil, fmt.Errorf("cannot read %s: %w (enable \"ignore host key\" to skip verification)", path, err)
	}
	return cb, nil
}

func buildSSHClientConfig(cfg *SSHConfig) (*ssh.ClientConfig, error) {
	if cfg == nil || !cfg.Enabled {
		return nil, errors.New("ssh is not enabled")
	}
	host := strings.TrimSpace(cfg.Host)
	if host == "" {
		return nil, errors.New("ssh host is required")
	}
	user := strings.TrimSpace(cfg.User)
	if user == "" {
		return nil, errors.New("ssh user is required")
	}

	var auths []ssh.AuthMethod
	if strings.TrimSpace(cfg.PrivateKey) != "" {
		var (
			signer ssh.Signer
			err    error
		)
		if cfg.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(cfg.PrivateKey), []byte(cfg.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(cfg.PrivateKey))
		}
		if err != nil {
			return nil, fmt.Errorf("invalid ssh private key: %w", err)
		}
		auths = append(auths, ssh.PublicKeys(signer))
	}
	if cfg.Password != "" {
		auths = append(auths, ssh.Password(cfg.Password))
	}
	if len(auths) == 0 {
		return nil, errors.New("ssh requires a password or a private key")
	}

	callback, err := hostKeyCallback(cfg.IgnoreHostKey)
	if err != nil {
		return nil, err
	}

	return &ssh.ClientConfig{
		User:            user,
		Auth:            auths,
		HostKeyCallback: callback,
		Timeout:         15 * time.Second,
	}, nil
}

// ensure returns the mysql network name to dial through, creating the SSH
// tunnel if necessary.
func (t *sshTunnel) ensure(info Connection) (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.client != nil {
		// Probe the tunnel; drop it if it is no longer alive.
		if _, _, err := t.client.SendRequest("keepalive@openssh.com", true, nil); err == nil {
			return t.network, nil
		}
		_ = t.client.Close()
		t.client = nil
	}

	cfg := info.SSH
	if cfg == nil || !cfg.Enabled {
		return "tcp", nil
	}
	clientConfig, err := buildSSHClientConfig(cfg)
	if err != nil {
		return "", err
	}

	port := cfg.Port
	if port == 0 {
		port = 22
	}
	addr := net.JoinHostPort(strings.TrimSpace(cfg.Host), strconv.Itoa(port))

	client, err := ssh.Dial("tcp", addr, clientConfig)
	if err != nil {
		return "", fmt.Errorf("ssh dial %s@%s: %w", clientConfig.User, addr, err)
	}

	network := "sshtunnel-" + info.ID
	mysql.RegisterDialContext(network, func(ctx context.Context, target string) (net.Conn, error) {
		// The target is the MySQL host:port as seen from the SSH server.
		return client.DialContext(ctx, "tcp", target)
	})

	t.client = client
	t.network = network
	return network, nil
}
