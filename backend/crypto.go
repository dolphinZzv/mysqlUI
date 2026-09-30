package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// encryptedPrefix marks values that are encrypted in the on-disk store.
const encryptedPrefix = "enc:v1:"

// secretKeyEnv is the environment variable holding the master key (32 bytes,
// hex or base64). When unset, a key is generated in <dataDir>/secret.key on
// first run.
const secretKeyEnv = "MYSQLUI_SECRET_KEY"

// Cipher encrypts sensitive connection fields at rest with AES-256-GCM.
type Cipher struct{ aead cipher.AEAD }

// NewCipher builds a Cipher from a 32-byte key.
func NewCipher(key []byte) (*Cipher, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("secret key must be 32 bytes, got %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Cipher{aead: aead}, nil
}

// LoadKey resolves the master key from MYSQLUI_SECRET_KEY or <dataDir>/secret.key,
// generating and persisting a new key (0600) on first use.
func LoadKey(dataDir string) ([]byte, error) {
	if env := strings.TrimSpace(os.Getenv(secretKeyEnv)); env != "" {
		return decodeKey(env)
	}
	path := filepath.Join(dataDir, "secret.key")
	data, err := os.ReadFile(path)
	if err == nil {
		return decodeKey(string(data))
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, []byte(hex.EncodeToString(key)), 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

func decodeKey(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	if b, err := hex.DecodeString(s); err == nil && len(b) == 32 {
		return b, nil
	}
	if b, err := base64.StdEncoding.DecodeString(s); err == nil && len(b) == 32 {
		return b, nil
	}
	if b, err := base64.RawStdEncoding.DecodeString(s); err == nil && len(b) == 32 {
		return b, nil
	}
	return nil, errors.New("secret key must be 32 bytes encoded as hex or base64")
}

// Encrypt returns the enc:v1: form of plaintext. Empty input stays empty.
func (c *Cipher) Encrypt(plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := c.aead.Seal(nonce, nonce, []byte(plaintext), nil)
	return encryptedPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt reverses Encrypt. Values without the enc:v1: prefix are returned as-is
// so existing plaintext stores keep working.
func (c *Cipher) Decrypt(value string) (string, error) {
	if !strings.HasPrefix(value, encryptedPrefix) {
		return value, nil
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, encryptedPrefix))
	if err != nil {
		return "", fmt.Errorf("invalid encrypted value: %w", err)
	}
	ns := c.aead.NonceSize()
	if len(raw) < ns {
		return "", errors.New("encrypted value is truncated")
	}
	plain, err := c.aead.Open(nil, raw[:ns], raw[ns:], nil)
	if err != nil {
		return "", fmt.Errorf("cannot decrypt secret (wrong %s?): %w", secretKeyEnv, err)
	}
	return string(plain), nil
}

func isEncrypted(value string) bool { return strings.HasPrefix(value, encryptedPrefix) }

// encryptConnection returns a copy with sensitive fields encrypted.
func (c *Cipher) encryptConnection(in Connection) (Connection, error) {
	out := in
	if in.SSH != nil {
		ssh := *in.SSH
		out.SSH = &ssh
	}
	var err error
	if out.Password, err = c.Encrypt(in.Password); err != nil {
		return out, err
	}
	if out.SSH != nil {
		if out.SSH.Password, err = c.Encrypt(in.SSH.Password); err != nil {
			return out, err
		}
		if out.SSH.PrivateKey, err = c.Encrypt(in.SSH.PrivateKey); err != nil {
			return out, err
		}
		if out.SSH.Passphrase, err = c.Encrypt(in.SSH.Passphrase); err != nil {
			return out, err
		}
	}
	return out, nil
}

// decryptConnection returns a copy with sensitive fields decrypted.
func (c *Cipher) decryptConnection(in Connection) (Connection, error) {
	out := in
	if in.SSH != nil {
		ssh := *in.SSH
		out.SSH = &ssh
	}
	var err error
	if out.Password, err = c.Decrypt(in.Password); err != nil {
		return out, err
	}
	if out.SSH != nil {
		if out.SSH.Password, err = c.Decrypt(in.SSH.Password); err != nil {
			return out, err
		}
		if out.SSH.PrivateKey, err = c.Decrypt(in.SSH.PrivateKey); err != nil {
			return out, err
		}
		if out.SSH.Passphrase, err = c.Decrypt(in.SSH.Passphrase); err != nil {
			return out, err
		}
	}
	return out, nil
}

// needsEncryption reports whether any sensitive field is still plaintext.
func needsEncryption(c Connection) bool {
	if c.Password != "" && !isEncrypted(c.Password) {
		return true
	}
	if c.SSH != nil {
		for _, v := range []string{c.SSH.Password, c.SSH.PrivateKey, c.SSH.Passphrase} {
			if v != "" && !isEncrypted(v) {
				return true
			}
		}
	}
	return false
}
