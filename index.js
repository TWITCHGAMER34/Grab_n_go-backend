// javascript
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const knexLib = require('knex');
const createSession = require('./middlewares/session');
const authRoutesFactory = require('./routes/auth');
const knexConfig = require('./knexfile.js');
const {hashPassword} = require("./utils/password");

const env = process.env.NODE_ENV || 'development';
const knex = knexLib(knexConfig[env] || knexConfig); // create a Knex instance from the config

const authRoutes = authRoutesFactory(knex);
const menuRoutes = require('./routes/menu')(knex);
const orderRoutes = require('./routes/orders')(knex);

const app = express();
app.use(express.json());

const corsOptions = {
    origin: 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT','PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// provide a session secret so the middleware can create sessions
app.use(createSession({secret: process.env.SESSION_SECRET || 'Keyboard Cat'}));


app.use('/auth', authRoutes);
app.use('/menu', menuRoutes);
app.use('/orders', orderRoutes);

app.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
})