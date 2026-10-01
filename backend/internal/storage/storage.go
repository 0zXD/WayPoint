package storage

import (
	"context"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Service defines the contract for storing and retrieving photo binaries.
type Service interface {
	Save(ctx context.Context, id string, data []byte, contentType string) (string, error)
	Get(ctx context.Context, id string) (io.ReadSeekCloser, string, int64, error)
	Delete(ctx context.Context, id string) error
	GetURL(id string) string
}

// LocalStorage implements Service using local disk files (with optional CDN URL prefix).
type LocalStorage struct {
	baseDir string
	cdnURL  string
	mu      sync.RWMutex
}

// NewLocalStorage creates a local disk storage provider.
func NewLocalStorage(baseDir, cdnURL string) (*LocalStorage, error) {
	if baseDir == "" {
		baseDir = "data/photos"
	}
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage dir %s: %w", baseDir, err)
	}
	cdnURL = strings.TrimRight(cdnURL, "/")
	return &LocalStorage{
		baseDir: baseDir,
		cdnURL:  cdnURL,
	}, nil
}

func (s *LocalStorage) filePath(id string) string {
	// Sanitize ID to prevent directory traversal
	cleanID := filepath.Base(id)
	return filepath.Join(s.baseDir, cleanID)
}

func (s *LocalStorage) metaPath(id string) string {
	return s.filePath(id) + ".meta"
}

func (s *LocalStorage) Save(ctx context.Context, id string, data []byte, contentType string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	p := s.filePath(id)
	if err := os.WriteFile(p, data, 0644); err != nil {
		return "", fmt.Errorf("failed to write photo file: %w", err)
	}

	// Persist MIME type in small companion metadata file
	if contentType != "" {
		_ = os.WriteFile(s.metaPath(id), []byte(contentType), 0644)
	}

	return s.GetURL(id), nil
}

func (s *LocalStorage) Get(ctx context.Context, id string) (io.ReadSeekCloser, string, int64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	p := s.filePath(id)
	f, err := os.Open(p)
	if err != nil {
		return nil, "", 0, err
	}

	stat, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, "", 0, err
	}

	// Read MIME type from metadata or detect from extension
	mimeType := "image/jpeg"
	if metaBytes, err := os.ReadFile(s.metaPath(id)); err == nil && len(metaBytes) > 0 {
		mimeType = string(metaBytes)
	} else {
		ext := filepath.Ext(p)
		if detected := mime.TypeByExtension(ext); detected != "" {
			mimeType = detected
		}
	}

	return f, mimeType, stat.Size(), nil
}

func (s *LocalStorage) Delete(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_ = os.Remove(s.filePath(id))
	_ = os.Remove(s.metaPath(id))
	return nil
}

func (s *LocalStorage) GetURL(id string) string {
	cleanID := filepath.Base(id)
	if s.cdnURL != "" {
		return fmt.Sprintf("%s/api/v1/memories/photo/%s", s.cdnURL, cleanID)
	}
	return fmt.Sprintf("/api/v1/memories/photo/%s", cleanID)
}
