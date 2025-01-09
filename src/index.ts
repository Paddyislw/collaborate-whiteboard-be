import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import prisma from './prisma';

const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true
}));
app.use(express.json());

interface DrawData {
  x: number;
  y: number;
  color: string;
  brushSize: number;
  isEraser: boolean;
}

io.on('connection', (socket) => {
    console.log('a user connected');
  
    socket.on('disconnect', () => {
      console.log('user disconnected');
    });
  
    socket.on('joinRoom', async ({ roomId, email, name }: { roomId: string, email: string, name: string }) => {
      socket.join(roomId);
      console.log(`User joined room: ${roomId}`);
  
      try {
        // Find or create the user
        const user = await prisma.user.upsert({
          where: { email: email },
          update: { name: name },
          create: {
            id: uuidv4(),
            email: email,
            name: name,
          },
        });
  
        // Find or create the whiteboard
        const whiteboard = await prisma.whiteboard.upsert({
          where: { id: roomId },
          update: {},
          create: {
            id: roomId,
            name: `Whiteboard ${roomId}`,
            imageData: '',
            userId: user.id,
          },
        });
  
        // Create a new whiteboard session
        await prisma.whiteboardSession.create({
          data: {
            whiteboardId: roomId,
            userId: user.id,
          },
        });
  
        console.log(`Created whiteboard session for room: ${roomId}`);
        
        // Send the user ID back to the client
        socket.emit('userCreated', user.id);
      } catch (error) {
        console.error('Error creating whiteboard session:', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });
  
    socket.on('draw', (data) => {
      socket.to(data.roomId).emit('draw', data);
    });
  
    socket.on('clearWhiteboard', (roomId) => {
      socket.to(roomId).emit('clearWhiteboard');
    });
  
    socket.on('saveWhiteboard', async ({ roomId, imageData, name,userId }) => {
      try {
        const updatedWhiteboard = await prisma.whiteboard.upsert({
          where: { id: roomId },
          update: {
            name: name,
            imageData: imageData,
          },
          create: {
            id: roomId,
            name: name,
            imageData: imageData,
            userId: userId
          },
        });
        console.log(`Whiteboard saved: ${updatedWhiteboard.id}`);
        socket.emit('whiteboardSaved', updatedWhiteboard.id);
      } catch (error) {
        console.error('Error saving whiteboard:', error);
        socket.emit('whiteboardSaveError', { message: 'Failed to save whiteboard' });
      }
    });
  
    socket.on('loadWhiteboard', async (whiteboardId, roomId) => {
      try {
        const whiteboard = await prisma.whiteboard.findUnique({
          where: { id: whiteboardId },
        });
        if (whiteboard) {
          io.to(roomId).emit('loadWhiteboard', whiteboard.imageData);
          console.log(`Whiteboard ${whiteboardId} loaded for room ${roomId}`);
        } else {
          socket.emit('whiteboardLoadError', { message: 'Whiteboard not found' });
        }
      } catch (error) {
        console.error('Error loading whiteboard:', error);
        socket.emit('whiteboardLoadError', { message: 'Failed to load whiteboard' });
      }
    });
  });
// API Routes
app.post('/api/users', async (req, res) => {
  const { email, name } = req.body;
  try {
    const user = await prisma.user.create({
      data: { email, name }
    });
    res.json(user);
  } catch (error) {
    res.status(400).json({ error: 'User creation failed' });
  }
});

app.get('/api/whiteboards', async (req, res) => {
  const whiteboards = await prisma.whiteboard.findMany({
    select: { id: true, name: true, createdAt: true, user: { select: { name: true } } }
  });
  res.json(whiteboards);
});

app.get('/api/whiteboards/:id', async (req, res) => {
  const { id } = req.params;
  const whiteboard = await prisma.whiteboard.findUnique({
    where: { id },
    include: { user: true }
  });
  if (whiteboard) {
    res.json(whiteboard);
  } else {
    res.status(404).json({ error: 'Whiteboard not found' });
  }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});