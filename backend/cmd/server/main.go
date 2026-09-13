package main

import (
	"fmt"
	"log"
	"net/http"

	"waypoint-backend/internal/config"
	"waypoint-backend/internal/db"
	"waypoint-backend/internal/handlers"
	"waypoint-backend/internal/middleware"
	"waypoint-backend/internal/ws"
)

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	database, err := db.Connect(cfg)
	if err != nil {
		log.Printf("PostgreSQL Connection notice: %v", err)
	} else {
		defer database.Close()
		if err := database.InitSchema(); err != nil {
			log.Printf("Notice on Schema Initialization: %v", err)
		} else {
			log.Println("PostgreSQL schema initialized successfully.")
		}
	}

	hub := ws.NewHub()
	go hub.Run()

	authHandler := handlers.NewAuthHandler(cfg, database)
	memoryHandler := handlers.NewMemoryHandler(cfg, database, hub)

	mux := http.NewServeMux()

	// WebSocket real-time stream
	mux.HandleFunc("/api/v1/ws", hub.ServeWS)

	// Memory routes
	mux.HandleFunc("GET /api/v1/memories/search", memoryHandler.SearchMemories)
	mux.HandleFunc("GET /api/v1/memories", memoryHandler.ListMemories)
	mux.HandleFunc("GET /api/v1/memories/photo/{id}", memoryHandler.GetPhoto)
	mux.HandleFunc("POST /api/v1/memories", middleware.AuthMiddleware(cfg, memoryHandler.CreateMemory))
	mux.HandleFunc("PUT /api/v1/memories/{id}", middleware.AuthMiddleware(cfg, memoryHandler.UpdateMemory))
	mux.HandleFunc("DELETE /api/v1/memories/{id}", middleware.AuthMiddleware(cfg, memoryHandler.DeleteMemory))
	mux.HandleFunc("DELETE /api/v1/memories/photo/{id}", middleware.AuthMiddleware(cfg, memoryHandler.DeletePhoto))

	// Auth routes
	mux.HandleFunc("/api/v1/auth/register", authHandler.Register)
	mux.HandleFunc("/api/v1/auth/login", authHandler.Login)
	mux.HandleFunc("/api/v1/auth/me", middleware.AuthMiddleware(cfg, authHandler.Me))
	mux.HandleFunc("/api/v1/auth/google/login", authHandler.GoogleLogin)
	mux.HandleFunc("/api/v1/auth/google/callback", authHandler.GoogleCallback)

	// Health check endpoint
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintln(w, `{"status":"ok","service":"waypoint-backend"}`)
	})

	handlerWithCORS := middleware.CORSMiddleware(cfg, mux)

	serverAddr := ":" + cfg.Port
	log.Printf("WayPoint Go Auth Backend listening on %s...", serverAddr)
	if err := http.ListenAndServe(serverAddr, handlerWithCORS); err != nil {
		log.Fatalf("Server stopped: %v", err)
	}
}
