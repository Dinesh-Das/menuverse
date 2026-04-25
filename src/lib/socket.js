import { io } from 'socket.io-client';

let socket = null;
// Track which rooms this socket has joined so we can rejoin after reconnect
const joinedRooms = { orders: new Set(), restaurants: new Set() };

export function getSocket() {
  if (!socket) {
    socket = io({
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);
      // Re-join all rooms after reconnect so real-time updates resume
      joinedRooms.orders.forEach(id => socket.emit('join:order', id));
      joinedRooms.restaurants.forEach(id => socket.emit('join:restaurant', id));
    });
    socket.on('disconnect', (reason) => console.warn('[Socket] Disconnected:', reason));
    socket.on('connect_error', (err) => console.error('[Socket] Error:', err.message));
  }
  return socket;
}

export function joinOrderRoom(orderId) {
  joinedRooms.orders.add(orderId);
  getSocket().emit('join:order', orderId);
}

export function joinRestaurantRoom(restaurantId) {
  joinedRooms.restaurants.add(restaurantId);
  getSocket().emit('join:restaurant', restaurantId);
}
