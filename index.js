// javascript
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const knexLib = require('knex');
const createSession = require('./middlewares/session');
const authRoutes = require('./routes/auth');
const knexConfig = require('./knexfile.js');

const env = process.env.NODE_ENV || 'development';
const knex = knexLib(knexConfig[env] || knexConfig); // create a Knex instance from the config

const menuRoutes = require('./routes/menu')(knex);

const app = express();
app.use(express.json());

const corsOptions = {
    origin: 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// provide a session secret so the middleware can create sessions
app.use(createSession({ secret: process.env.SESSION_SECRET || 'change-me' }));

app.use('/auth', authRoutes);
app.use('/menu', menuRoutes);

app.listen(3000, () => console.log('Server listening on port 3000'));
