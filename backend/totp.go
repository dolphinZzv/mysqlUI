package main

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

// totpPeriod is the RFC 6238 time step in seconds.
const totpPeriod = 30

// validateTOTP checks a 6-digit code against a base32-encoded RFC 6238 secret.
// It accepts the adjacent time steps to tolerate small clock skew.
func validateTOTP(secret, code string, now time.Time) bool {
	normalized := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(secret), " ", ""))
	normalized = strings.TrimRight(normalized, "=")
	if normalized == "" {
		return false
	}
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(normalized)
	if err != nil || len(key) == 0 {
		return false
	}
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return false
	}
	counter := now.Unix() / totpPeriod
	for _, delta := range []int64{-1, 0, 1} {
		if hotp(key, counter+delta) == code {
			return true
		}
	}
	return false
}

// hotp computes an RFC 4226 HMAC-SHA1 one-time password.
func hotp(key []byte, counter int64) string {
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], uint64(counter))
	mac := hmac.New(sha1.New, key)
	mac.Write(buf[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := (int64(sum[offset])&0x7f)<<24 |
		int64(sum[offset+1])<<16 |
		int64(sum[offset+2])<<8 |
		int64(sum[offset+3])
	return fmt.Sprintf("%06d", value%1_000_000)
}
