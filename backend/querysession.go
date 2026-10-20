package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"
)

const querySessionIdleTimeout = 30 * time.Minute

type activeQuery struct {
	mu           sync.Mutex
	connectionID string
	mysqlID      int64
	cancel       context.CancelFunc
	canceled     bool
}

func (a *activeQuery) setMySQLID(id int64) {
	a.mu.Lock()
	a.mysqlID = id
	a.mu.Unlock()
}

func (a *activeQuery) markCanceled() (int64, context.CancelFunc) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.canceled = true
	return a.mysqlID, a.cancel
}

func (a *activeQuery) wasCanceled() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.canceled
}

// querySession keeps a single MySQL connection alive across query requests so
// BEGIN/COMMIT/ROLLBACK, temporary tables and session variables behave like a
// SQL console. Sessions are serialised with a mutex and evicted after idling.
type querySession struct {
	id           string
	connectionID string
	database     string
	conn         *sql.Conn
	runMu        sync.Mutex
	activeMu     sync.Mutex
	active       *activeQuery
	lastUsed     time.Time
}

func (s *querySession) setActive(q *activeQuery) {
	s.activeMu.Lock()
	s.active = q
	s.activeMu.Unlock()
}

func (s *querySession) clearActive(q *activeQuery) {
	s.activeMu.Lock()
	if s.active == q {
		s.active = nil
	}
	s.activeMu.Unlock()
}

func (s *querySession) currentActive() *activeQuery {
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	return s.active
}

func (s *querySession) touch() {
	s.activeMu.Lock()
	s.lastUsed = time.Now()
	s.activeMu.Unlock()
}

func (s *querySession) idleFor() time.Duration {
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	return time.Since(s.lastUsed)
}

func (s *querySession) close() {
	// Roll back an open transaction before returning the connection to the pool.
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _ = s.conn.ExecContext(ctx, "ROLLBACK")
	_ = s.conn.Close()
}

type querySessionManager struct {
	mu       sync.Mutex
	sessions map[string]*querySession
}

func newQuerySessionManager() *querySessionManager {
	return &querySessionManager{sessions: map[string]*querySession{}}
}

func (m *querySessionManager) get(ctx context.Context, entry *ConnEntry, database, id string) (*querySession, error) {
	m.mu.Lock()
	if existing := m.sessions[id]; existing != nil {
		if existing.connectionID == entry.Info.ID && existing.database == database {
			existing.touch()
			m.mu.Unlock()
			return existing, nil
		}
		delete(m.sessions, id)
		m.mu.Unlock()
		existing.close()
		return m.create(ctx, entry, database, id)
	}
	m.mu.Unlock()
	return m.create(ctx, entry, database, id)
}

func (m *querySessionManager) create(ctx context.Context, entry *ConnEntry, database, id string) (*querySession, error) {
	db, err := entry.getDB(database)
	if err != nil {
		return nil, err
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	s := &querySession{
		id:           id,
		connectionID: entry.Info.ID,
		database:     database,
		conn:         conn,
		lastUsed:     time.Now(),
	}
	m.mu.Lock()
	// Another request may have created the same session concurrently.
	if existing := m.sessions[id]; existing != nil {
		m.mu.Unlock()
		_ = conn.Close()
		return existing, nil
	}
	m.sessions[id] = s
	m.mu.Unlock()
	return s, nil
}

func (m *querySessionManager) remove(id string) {
	m.mu.Lock()
	s := m.sessions[id]
	delete(m.sessions, id)
	m.mu.Unlock()
	if s != nil {
		s.close()
	}
}

func (m *querySessionManager) cleanup(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			var stale []string
			m.mu.Lock()
			for id, s := range m.sessions {
				if s.idleFor() > querySessionIdleTimeout {
					stale = append(stale, id)
				}
			}
			m.mu.Unlock()
			for _, id := range stale {
				m.remove(id)
			}
		}
	}
}

// cancelRunningQuery cancels a query by client-provided run id and also sends
// KILL on a separate pooled connection for a faster server-side abort.
func (s *Server) cancelRunningQuery(w http.ResponseWriter, r *http.Request) int {
	runID := r.PathValue("runId")
	entry, err := s.store.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return 0
	}
	value, ok := s.queries.Load(runID)
	if !ok {
		writeErr(w, http.StatusNotFound, errors.New("query is not running"))
		return 0
	}
	aq, ok := value.(*activeQuery)
	if !ok || aq.connectionID != entry.Info.ID {
		writeErr(w, http.StatusNotFound, errors.New("query is not running"))
		return 0
	}
	mysqlID, cancel := aq.markCanceled()
	if cancel != nil {
		cancel()
	}
	if mysqlID > 0 {
		ctx, done := context.WithTimeout(context.Background(), 3*time.Second)
		defer done()
		if db, err := entry.getDB(""); err == nil {
			_, _ = db.ExecContext(ctx, fmt.Sprintf("KILL %d", mysqlID))
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	return 1
}
