package config

import (
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

type Config struct {
	Port               string
	FrontendURL        string
	DBHost             string
	DBPort             string
	DBUser             string
	DBPassword         string
	DBName             string
	DBSSLMode          string
	JWTSecret          string
	JWTExpirationHours int
	GoogleClientID     string
	GoogleClientSecret string
	GoogleRedirectURL  string
	MapTilerAPIKey     string
	StorageType        string
	StorageDir         string
	PhotoCDNURL        string
}

func LoadConfig() (*Config, error) {
	// Attempt to load .env if present (ignore error if not found in prod)
	_ = godotenv.Load()

	jwtExp, err := strconv.Atoi(getEnv("JWT_EXPIRATION_HOURS", "72"))
	if err != nil {
		jwtExp = 72
	}

	cfg := &Config{
		Port:               getEnv("PORT", "8000"),
		FrontendURL:        getEnv("FRONTEND_URL", "http://localhost:5173"),
		DBHost:             getEnv("DB_HOST", "localhost"),
		DBPort:             getEnv("DB_PORT", "5432"),
		DBUser:             getEnv("DB_USER", "postgres"),
		DBPassword:         getEnv("DB_PASSWORD", "postgres"),
		DBName:             getEnv("DB_NAME", "waypoint"),
		DBSSLMode:          getEnv("DB_SSLMODE", "disable"),
		JWTSecret:          getEnv("JWT_SECRET", ""),
		JWTExpirationHours: jwtExp,
		GoogleClientID:     getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: getEnv("GOOGLE_CLIENT_SECRET", ""),
		GoogleRedirectURL:  getEnv("GOOGLE_REDIRECT_URL", "http://localhost:8000/api/v1/auth/google/callback"),
		MapTilerAPIKey:     getEnv("MAPTILER_API_KEY", ""),
		StorageType:        getEnv("STORAGE_TYPE", "local"),
		StorageDir:         getEnv("STORAGE_DIR", "data/photos"),
		PhotoCDNURL:        getEnv("PHOTO_CDN_URL", ""),
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if val, ok := os.LookupEnv(key); ok && val != "" {
		return val
	}
	return fallback
}
