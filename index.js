const express = require('express');
const knexLib = require('knex');
const path = require('path');
const createSession = require('./middlewares/session');
require('dotenv').config();


const env = process.env.NODE_ENV || 'development';
const knexConfig = require('./knexfile')[env];
const knex = knexLib(knexConfig);

const app = express();
app.use(express.json());
app.use(createSession());

// mount auth routes
app.use('/auth', require('./routes/auth')(knex));

// mount menu routes
app.use('/menu', require('./routes/menu')(knex));

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
});