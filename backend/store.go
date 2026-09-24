package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

// Connection is the persisted description of a MySQL server.
type Connection struct {
	ID       string     `json:"id"`
	Name     string     `json:"name"`
	Host     string     `json:"host"`
	Port     int        `json:"port"`
	User     string     `json:"user"`
	Password string     `json:"password"`
	Database string     `json:"database"`
	SSL      string     `json:"ssl,omitempty"`
	Color    string     `json:"color,omitempty"`
	SSH      *SSHConfig `json:"ssh,omitempty"`
}

// ConnEntry couples a Connection with lazily created connection pools, one per
// database. Using one pool per database avoids racy `USE db` statements.
type ConnEntry struct {
	Info   Connection
	mu     sync.Mutex
	pools  map[string]*sql.DB
	tunnel *sshTunnel
}

func newConnEntry(info Connection) *ConnEntry {
	return &ConnEntry{Info: info, pools: map[string]*sql.DB{}, tunnel: &sshTunnel{}}
}

func (e *ConnEntry) Close() {
	e.mu.Lock()
	for k, db := range e.pools {
		_ = db.Close()
		delete(e.pools, k)
	}
	e.mu.Unlock()
	if e.tunnel != nil {
		e.tunnel.Close()
	}
}

func (e *ConnEntry) dsn(database, network string) string {
	cfg := mysql.NewConfig()
	cfg.User = e.Info.User
	cfg.Passwd = e.Info.Password
	cfg.Net = network
	cfg.Addr = fmt.Sprintf("%s:%d", e.Info.Host, e.Info.Port)
	cfg.DBName = database
	cfg.ParseTime = true
	cfg.Loc = time.Local
	cfg.Params = map[string]string{"charset": "utf8mb4"}
	cfg.Timeout = 10 * time.Second
	cfg.ReadTimeout = 60 * time.Second
	cfg.WriteTimeout = 60 * time.Second
	if e.Info.SSL != "" && e.Info.SSL != "disabled" {
		cfg.TLSConfig = e.Info.SSL
	}
	return cfg.FormatDSN()
}

// getDB returns a cached pool for the given database, creating and verifying it
// on first use.
func (e *ConnEntry) getDB(database string) (*sql.DB, error) {
	network := "tcp"
	if e.Info.SSH != nil && e.Info.SSH.Enabled {
		n, err := e.tunnel.ensure(e.Info)
		if err != nil {
			return nil, err
		}
		network = n
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	if db, ok := e.pools[database]; ok {
		if err := db.Ping(); err == nil {
			return db, nil
		}
		_ = db.Close()
		delete(e.pools, database)
	}

	db, err := sql.Open("mysql", e.dsn(database, network))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	e.pools[database] = db
	return db, nil
}

func (e *ConnEntry) Ping() error {
	db, err := e.getDB(e.Info.Database)
	if err != nil {
		return err
	}
	return db.Ping()
}

// Store keeps all connections in memory and persists their metadata as JSON.
type Store struct {
	mu    sync.RWMutex
	path  string
	conns map[string]*ConnEntry
}

func NewStore(path string) (*Store, error) {
	s := &Store{path: path, conns: map[string]*ConnEntry{}}
	data, err := os.ReadFile(path)
	if err == nil {
		var list []Connection
		if err := json.Unmarshal(data, &list); err == nil {
			for _, c := range list {
				s.conns[c.ID] = newConnEntry(c)
			}
		}
	}
	return s, nil
}

func (s *Store) saveLocked() error {
	list := make([]Connection, 0, len(s.conns))
	for _, e := range s.conns {
		list = append(list, e.Info)
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	if dir := filepath.Dir(s.path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return os.WriteFile(s.path, data, 0o600)
}

func (s *Store) List() []Connection {
	s.mu.RLock()
	defer s.mu.RUnlock()
	list := make([]Connection, 0, len(s.conns))
	for _, e := range s.conns {
		list = append(list, e.Info)
	}
	return list
}

func (s *Store) Get(id string) (*ConnEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	e, ok := s.conns[id]
	if !ok {
		return nil, errors.New("connection not found")
	}
	return e, nil
}

func (s *Store) Create(c Connection) (*ConnEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c.ID == "" {
		c.ID = uuid.NewString()
	}
	if c.Port == 0 {
		c.Port = 3306
	}
	e := newConnEntry(c)
	s.conns[c.ID] = e
	if err := s.saveLocked(); err != nil {
		delete(s.conns, c.ID)
		return nil, err
	}
	return e, nil
}

func (s *Store) Update(id string, c Connection) (*ConnEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.conns[id]
	if !ok {
		return nil, errors.New("connection not found")
	}
	if c.Port == 0 {
		c.Port = 3306
	}
	c.ID = id
	prev := e.Info
	e.Info = c
	if err := s.saveLocked(); err != nil {
		e.Info = prev
		return nil, err
	}
	// Credentials or host may have changed: drop existing pools.
	e.Close()
	return e, nil
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.conns[id]
	if !ok {
		return errors.New("connection not found")
	}
	e.Close()
	delete(s.conns, id)
	return s.saveLocked()
}
