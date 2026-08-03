package handlers

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"waypoint-backend/internal/config"
	"waypoint-backend/internal/db"
	"waypoint-backend/internal/middleware"
	"waypoint-backend/internal/models"
	"waypoint-backend/internal/ws"

	"github.com/lib/pq"
)

type MemoryHandler struct {
	cfg *config.Config
	db  *db.DB
	hub *ws.Hub
}

func NewMemoryHandler(cfg *config.Config, database *db.DB, hub *ws.Hub) *MemoryHandler {
	return &MemoryHandler{
		cfg: cfg,
		db:  database,
		hub: hub,
	}
}

func (h *MemoryHandler) CreateMemory(w http.ResponseWriter, r *http.Request) {
	// 10MB limit
	err := r.ParseMultipartForm(10 << 20)
	if err != nil {
		http.Error(w, `{"error":"File too large or invalid form"}`, http.StatusBadRequest)
		return
	}

	userID := r.Context().Value(middleware.UserIDKey).(string)

	files := r.MultipartForm.File["images"]
	if len(files) == 0 {
		http.Error(w, `{"error":"At least one image is required"}`, http.StatusBadRequest)
		return
	}
	if len(files) > 4 {
		http.Error(w, `{"error":"Maximum 4 images allowed"}`, http.StatusBadRequest)
		return
	}

	type UploadedPhoto struct {
		ID          string
		ImageBase64 string
		MimeType    string
	}
	var uploadedPhotos []UploadedPhoto

	for _, fileHeader := range files {
		file, err := fileHeader.Open()
		if err != nil {
			http.Error(w, `{"error":"Failed to open image"}`, http.StatusInternalServerError)
			return
		}
		fileBytes, err := io.ReadAll(file)
		file.Close()
		if err != nil {
			http.Error(w, `{"error":"Failed to read image"}`, http.StatusInternalServerError)
			return
		}

		mimeType := fileHeader.Header.Get("Content-Type")
		imageBase64 := base64.StdEncoding.EncodeToString(fileBytes)
		// Small sleep to ensure unique UnixNano for fast loops, or just use loop index
		time.Sleep(1 * time.Millisecond)
		uploadedPhotos = append(uploadedPhotos, UploadedPhoto{
			ID:          fmt.Sprintf("pho-%d", time.Now().UnixNano()),
			ImageBase64: imageBase64,
			MimeType:    mimeType,
		})
	}

	title := r.FormValue("title")
	narrative := r.FormValue("narrative")
	locationTag := r.FormValue("locationTag")

	lat, err := strconv.ParseFloat(r.FormValue("lat"), 64)
	if err != nil {
		http.Error(w, `{"error":"Invalid latitude"}`, http.StatusBadRequest)
		return
	}
	lng, err := strconv.ParseFloat(r.FormValue("lng"), 64)
	if err != nil {
		http.Error(w, `{"error":"Invalid longitude"}`, http.StatusBadRequest)
		return
	}

	memoryID := fmt.Sprintf("mem-%d", time.Now().UnixNano())
	createdAt := time.Now()

	// Get user name for broadcast
	var userName string
	err = h.db.DB.QueryRow("SELECT name FROM users WHERE id = $1", userID).Scan(&userName)
	if err != nil {
		userName = "A user"
	}

	// Transaction
	tx, err := h.db.DB.Begin()
	if err != nil {
		http.Error(w, `{"error":"Database error"}`, http.StatusInternalServerError)
		return
	}

	_, err = tx.Exec(`
		INSERT INTO memories (id, user_id, title, narrative, lat, lng, location_tag, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
		memoryID, userID, title, narrative, lat, lng, locationTag, createdAt)
	if err != nil {
		tx.Rollback()
		log.Printf("Failed to insert memory: %v", err)
		http.Error(w, `{"error":"Failed to save memory"}`, http.StatusInternalServerError)
		return
	}

	for _, p := range uploadedPhotos {
		_, err = tx.Exec(`
			INSERT INTO photos (id, memory_id, image_base64, mime_type)
			VALUES ($1, $2, $3, $4)`,
			p.ID, memoryID, p.ImageBase64, p.MimeType)
		if err != nil {
			tx.Rollback()
			log.Printf("Failed to insert photo: %v", err)
			http.Error(w, `{"error":"Failed to save photo"}`, http.StatusInternalServerError)
			return
		}
	}

	err = tx.Commit()
	if err != nil {
		http.Error(w, `{"error":"Failed to commit"}`, http.StatusInternalServerError)
		return
	}

	// Broadcast
	h.hub.BroadcastEvent(ws.ActivityEvent{
		ID:          fmt.Sprintf("evt-%d", time.Now().UnixNano()),
		Type:        "memory.created",
		ActorName:   userName,
		MemoryTitle: title,
		CreatedAt:   createdAt.UTC().Format(time.RFC3339),
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	fmt.Fprintf(w, `{"status":"success","id":"%s"}`, memoryID)
}

func (h *MemoryHandler) ListMemories(w http.ResponseWriter, r *http.Request) {
	// Bbox
	minLng, _ := strconv.ParseFloat(r.URL.Query().Get("minLng"), 64)
	minLat, _ := strconv.ParseFloat(r.URL.Query().Get("minLat"), 64)
	maxLng, _ := strconv.ParseFloat(r.URL.Query().Get("maxLng"), 64)
	maxLat, _ := strconv.ParseFloat(r.URL.Query().Get("maxLat"), 64)

	// Since longitude can wrap around (-180 to 180), bounding box queries usually require careful logic.
	// For simplicity, we just query lat/lng within the bounds, ignoring the wrap around logic for now.
	
	query := `
		SELECT m.id, m.user_id, m.title, m.narrative, m.lat, m.lng, m.location_tag, m.created_at, u.name, COALESCE(u.avatar_url, ''),
		       ARRAY_REMOVE(ARRAY_AGG(p.id), NULL) AS photo_ids
		FROM memories m
		JOIN users u ON m.user_id = u.id
		LEFT JOIN photos p ON m.id = p.memory_id
		WHERE m.lat >= $1 AND m.lat <= $2 AND m.lng >= $3 AND m.lng <= $4
		GROUP BY m.id, u.name, u.avatar_url
		ORDER BY m.created_at DESC
		LIMIT 100
	`

	rows, err := h.db.DB.Query(query, minLat, maxLat, minLng, maxLng)
	if err != nil {
		log.Printf("Failed to list memories: %v", err)
		http.Error(w, `{"error":"Failed to fetch memories"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var memories []models.Memory
	for rows.Next() {
		var m models.Memory
		var photoIDs pq.StringArray
		err := rows.Scan(&m.ID, &m.UserID, &m.Title, &m.Narrative, &m.Lat, &m.Lng, &m.LocationTag, &m.CreatedAt, &m.AuthorName, &m.AuthorAvatar, &photoIDs)
		if err != nil {
			continue
		}
		
		m.Photos = make([]models.PhotoResponse, 0)
		for _, pid := range photoIDs {
			m.Photos = append(m.Photos, models.PhotoResponse{
				ID:  pid,
				URL: fmt.Sprintf("/api/v1/memories/photo/%s", pid),
			})
		}
		
		memories = append(memories, m)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(memories)
}

func (h *MemoryHandler) SearchMemories(w http.ResponseWriter, r *http.Request) {
	queryTerm := r.URL.Query().Get("q")
	if queryTerm == "" {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]"))
		return
	}

	searchPattern := "%" + queryTerm + "%"
	query := `
		SELECT m.id, m.user_id, m.title, m.narrative, m.lat, m.lng, m.location_tag, m.created_at, u.name, COALESCE(u.avatar_url, ''),
		       ARRAY_REMOVE(ARRAY_AGG(p.id), NULL) AS photo_ids
		FROM memories m
		JOIN users u ON m.user_id = u.id
		LEFT JOIN photos p ON m.id = p.memory_id
		WHERE m.title ILIKE $1 OR m.location_tag ILIKE $1 OR m.narrative ILIKE $1
		GROUP BY m.id, u.name, u.avatar_url
		ORDER BY m.created_at DESC
		LIMIT 20
	`

	rows, err := h.db.DB.Query(query, searchPattern)
	if err != nil {
		log.Printf("Failed to search memories: %v", err)
		http.Error(w, `{"error":"Failed to search memories"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var memories []models.Memory
	for rows.Next() {
		var m models.Memory
		var photoIDs pq.StringArray
		err := rows.Scan(&m.ID, &m.UserID, &m.Title, &m.Narrative, &m.Lat, &m.Lng, &m.LocationTag, &m.CreatedAt, &m.AuthorName, &m.AuthorAvatar, &photoIDs)
		if err != nil {
			continue
		}
		
		m.Photos = make([]models.PhotoResponse, 0)
		for _, pid := range photoIDs {
			m.Photos = append(m.Photos, models.PhotoResponse{
				ID:  pid,
				URL: fmt.Sprintf("/api/v1/memories/photo/%s", pid),
			})
		}
		
		memories = append(memories, m)
	}

	if memories == nil {
		memories = []models.Memory{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(memories)
}

func (h *MemoryHandler) DeletePhoto(w http.ResponseWriter, r *http.Request) {
	photoID := r.PathValue("id")
	if photoID == "" {
		http.Error(w, `{"error":"Missing photo ID"}`, http.StatusBadRequest)
		return
	}

	userID := r.Context().Value(middleware.UserIDKey).(string)

	// Verify the user owns the memory associated with this photo
	var memoryOwnerID string
	err := h.db.DB.QueryRow(`
		SELECT m.user_id 
		FROM memories m
		JOIN photos p ON m.id = p.memory_id
		WHERE p.id = $1
	`, photoID).Scan(&memoryOwnerID)

	if err != nil {
		http.Error(w, `{"error":"Photo not found or you don't have permission"}`, http.StatusNotFound)
		return
	}

	if memoryOwnerID != userID {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusForbidden)
		return
	}

	_, err = h.db.DB.Exec("DELETE FROM photos WHERE id = $1", photoID)
	if err != nil {
		http.Error(w, `{"error":"Failed to delete photo"}`, http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success":true}`))
}

func (h *MemoryHandler) GetPhoto(w http.ResponseWriter, r *http.Request) {
	photoID := r.PathValue("id")
	if photoID == "" {
		http.Error(w, "Missing ID", http.StatusBadRequest)
		return
	}

	var imageBase64, mimeType string
	err := h.db.DB.QueryRow("SELECT image_base64, mime_type FROM photos WHERE id = $1", photoID).Scan(&imageBase64, &mimeType)
	if err != nil {
		http.Error(w, "Photo not found", http.StatusNotFound)
		return
	}

	data, err := base64.StdEncoding.DecodeString(imageBase64)
	if err != nil {
		http.Error(w, "Failed to decode photo", http.StatusInternalServerError)
		return
	}

	// Important: add caching headers so the browser doesn't refetch the photo constantly
	w.Header().Set("Cache-Control", "public, max-age=31536000")
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Write(data)
}

func (h *MemoryHandler) DeleteMemory(w http.ResponseWriter, r *http.Request) {
	memoryID := r.PathValue("id")
	if memoryID == "" {
		http.Error(w, `{"error":"Missing ID"}`, http.StatusBadRequest)
		return
	}

	userID := r.Context().Value(middleware.UserIDKey).(string)

	// Ensure the user actually owns this memory before deleting
	res, err := h.db.DB.Exec("DELETE FROM memories WHERE id = $1 AND user_id = $2", memoryID, userID)
	if err != nil {
		log.Printf("Failed to delete memory: %v", err)
		http.Error(w, `{"error":"Database error"}`, http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := res.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, `{"error":"Not found or unauthorized"}`, http.StatusNotFound)
		return
	}

	// Broadcast deletion if necessary? For now just return success.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"status":"success"}`)
}

func (h *MemoryHandler) UpdateMemory(w http.ResponseWriter, r *http.Request) {
	memoryID := r.PathValue("id")
	if memoryID == "" {
		http.Error(w, `{"error":"Missing ID"}`, http.StatusBadRequest)
		return
	}

	userID := r.Context().Value(middleware.UserIDKey).(string)

	// Verify ownership
	var existingUserID string
	err := h.db.DB.QueryRow("SELECT user_id FROM memories WHERE id = $1", memoryID).Scan(&existingUserID)
	if err != nil {
		http.Error(w, `{"error":"Not found"}`, http.StatusNotFound)
		return
	}
	if existingUserID != userID {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusForbidden)
		return
	}

	err = r.ParseMultipartForm(10 << 20)
	if err != nil {
		http.Error(w, `{"error":"File too large or invalid format"}`, http.StatusBadRequest)
		return
	}

	files := r.MultipartForm.File["images"]
	// Determine how many photos this memory currently has to enforce the 4 limit, 
	// but for simplicity we will just let the frontend enforce the 4 photo limit
	// or they can upload up to 4 new ones.
	if len(files) > 4 {
		http.Error(w, `{"error":"Maximum 4 images allowed per upload batch"}`, http.StatusBadRequest)
		return
	}

	type UploadedPhoto struct {
		ID          string
		ImageBase64 string
		MimeType    string
	}
	var uploadedPhotos []UploadedPhoto

	for _, fileHeader := range files {
		file, err := fileHeader.Open()
		if err != nil {
			http.Error(w, `{"error":"Failed to open image"}`, http.StatusInternalServerError)
			return
		}
		fileBytes, err := io.ReadAll(file)
		file.Close()
		if err != nil {
			http.Error(w, `{"error":"Failed to read image"}`, http.StatusInternalServerError)
			return
		}

		mimeType := fileHeader.Header.Get("Content-Type")
		imageBase64 := base64.StdEncoding.EncodeToString(fileBytes)
		time.Sleep(1 * time.Millisecond)
		uploadedPhotos = append(uploadedPhotos, UploadedPhoto{
			ID:          fmt.Sprintf("pho-%d", time.Now().UnixNano()),
			ImageBase64: imageBase64,
			MimeType:    mimeType,
		})
	}

	title := r.FormValue("title")
	narrative := r.FormValue("narrative")
	locationTag := r.FormValue("locationTag")

	lat, err := strconv.ParseFloat(r.FormValue("lat"), 64)
	if err != nil {
		http.Error(w, `{"error":"Invalid latitude"}`, http.StatusBadRequest)
		return
	}
	lng, err := strconv.ParseFloat(r.FormValue("lng"), 64)
	if err != nil {
		http.Error(w, `{"error":"Invalid longitude"}`, http.StatusBadRequest)
		return
	}

	updatedAt := time.Now()

	tx, err := h.db.DB.Begin()
	if err != nil {
		http.Error(w, `{"error":"Database error"}`, http.StatusInternalServerError)
		return
	}

	_, err = tx.Exec(`
		UPDATE memories 
		SET title = $1, narrative = $2, lat = $3, lng = $4, location_tag = $5, updated_at = $6
		WHERE id = $7 AND user_id = $8`,
		title, narrative, lat, lng, locationTag, updatedAt, memoryID, userID)
	if err != nil {
		tx.Rollback()
		log.Printf("Failed to update memory: %v", err)
		http.Error(w, `{"error":"Failed to update memory"}`, http.StatusInternalServerError)
		return
	}

	for _, p := range uploadedPhotos {
		_, err = tx.Exec(`
			INSERT INTO photos (id, memory_id, image_base64, mime_type)
			VALUES ($1, $2, $3, $4)`,
			p.ID, memoryID, p.ImageBase64, p.MimeType)
		if err != nil {
			tx.Rollback()
			log.Printf("Failed to insert photo: %v", err)
			http.Error(w, `{"error":"Failed to save photo"}`, http.StatusInternalServerError)
			return
		}
	}

	err = tx.Commit()
	if err != nil {
		http.Error(w, `{"error":"Failed to commit"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"status":"success","id":"%s"}`, memoryID)
}
