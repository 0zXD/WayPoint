package ws

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type ActivityEvent struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	ActorName   string `json:"actorName"`
	MemoryID    string `json:"memoryId,omitempty"`
	MemoryTitle string `json:"memoryTitle,omitempty"`
	CreatedAt   string `json:"createdAt"`
}

type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	mu     sync.Mutex
	closed bool
}

func (c *Client) safeSend(msg []byte) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return false
	}
	select {
	case c.send <- msg:
		return true
	default:
		return false
	}
}

func (c *Client) safeClose() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.send)
	}
}

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.Mutex
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow CORS for all WebSocket connections
	},
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (h *Hub) Run() {
	go h.startSimulationTicker()

	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("WebSocket client connected. Total clients: %d", len(h.clients))
			go h.sendWelcomeEvent(client)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				client.safeClose()
			}
			h.mu.Unlock()
			log.Printf("WebSocket client disconnected. Total clients: %d", len(h.clients))

		case message := <-h.broadcast:
			h.mu.Lock()
			for client := range h.clients {
				if !client.safeSend(message) {
					client.safeClose()
					delete(h.clients, client)
				}
			}
			h.mu.Unlock()
		}
	}
}

func (h *Hub) BroadcastEvent(event ActivityEvent) {
	if event.CreatedAt == "" {
		event.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if event.ID == "" {
		event.ID = fmt.Sprintf("evt-%d", time.Now().UnixNano())
	}
	bytes, err := json.Marshal(event)
	if err == nil {
		h.broadcast <- bytes
	}
}

func (h *Hub) sendWelcomeEvent(c *Client) {
	evt := ActivityEvent{
		ID:          fmt.Sprintf("welcome-%d", time.Now().UnixNano()),
		Type:        "memory.created",
		ActorName:   "WayPoint System",
		MemoryTitle: "Live Real-Time Stream Connected",
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	bytes, _ := json.Marshal(evt)
	c.safeSend(bytes)
}

func (h *Hub) startSimulationTicker() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	names := []string{"Ines", "Jonah", "Ren", "Priya", "Milo", "Elena", "Marcus"}
	titles := []string{
		"Sunrise over Notre-Dame",
		"Late shift at Blue Bottle",
		"Wet stones, Shibuya",
		"Fog rolling into the bay",
		"Stargazing at Joshua Tree",
		"Midnight coffee in Trastevere",
	}
	types := []string{"memory.created", "memory.commented", "collection.shared"}

	for range ticker.C {
		h.mu.Lock()
		clientCount := len(h.clients)
		h.mu.Unlock()

		if clientCount > 0 {
			event := ActivityEvent{
				ID:          fmt.Sprintf("live-%d", time.Now().UnixNano()),
				Type:        types[rand.Intn(len(types))],
				ActorName:   names[rand.Intn(len(names))],
				MemoryTitle: titles[rand.Intn(len(titles))],
				CreatedAt:   time.Now().UTC().Format(time.RFC3339),
			}
			h.BroadcastEvent(event)
		}
	}
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

func (c *Client) writePump() {
	defer func() {
		c.conn.Close()
	}()
	for message := range c.send {
		err := c.conn.WriteMessage(websocket.TextMessage, message)
		if err != nil {
			break
		}
	}
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	var responseHeader http.Header
	if subprotocol := r.Header.Get("Sec-WebSocket-Protocol"); subprotocol != "" {
		responseHeader = http.Header{}
		parts := strings.Split(subprotocol, ",")
		if len(parts) > 0 {
			responseHeader.Set("Sec-WebSocket-Protocol", strings.TrimSpace(parts[0]))
		}
	}
	conn, err := upgrader.Upgrade(w, r, responseHeader)
	if err != nil {
		log.Printf("Failed to upgrade websocket connection: %v", err)
		return
	}
	client := &Client{hub: h, conn: conn, send: make(chan []byte, 256)}
	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}
