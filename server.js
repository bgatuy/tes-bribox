
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const app = express();
const port = 3000;
const JWT_SECRET = 'your_jwt_secret'; // In a real app, use an environment variable

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// Multer storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const userId = req.userId;
    const userUploadsPath = `uploads/${userId}`;
    if (!fs.existsSync(userUploadsPath)) {
      fs.mkdirSync(userUploadsPath, { recursive: true });
    }
    cb(null, userUploadsPath);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage: storage });

// Middleware to verify token
function verifyToken(req, res, next) {
  const token = req.headers['x-access-token'];

  if (!token) {
    return res.status(403).json({ auth: false, message: 'No token provided.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(500).json({ auth: false, message: 'Failed to authenticate token.' });
    }

    req.userId = decoded.id;
    next();
  });
}

// Registration endpoint
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  fs.readFile('db.json', 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Error reading database' });
    }

    const db = JSON.parse(data);
    const existingUser = db.users.find(user => user.username === username);

    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 8);
    const newUser = {
      id: db.users.length > 0 ? Math.max(...db.users.map(u => u.id)) + 1 : 1,
      username,
      password: hashedPassword,
    };

    db.users.push(newUser);

    fs.writeFile('db.json', JSON.stringify(db, null, 2), (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Error saving user to database' });
      }

      const token = jwt.sign({ id: newUser.id }, JWT_SECRET, {
        expiresIn: 86400 // 24 hours
      });

      res.status(201).json({ auth: true, token });
    });
  });
});

// Login endpoint
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  fs.readFile('db.json', 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Error reading database' });
    }

    const db = JSON.parse(data);
    const user = db.users.find(user => user.username === username);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const passwordIsValid = bcrypt.compareSync(password, user.password);

    if (!passwordIsValid) {
      return res.status(401).json({ auth: false, token: null });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, {
      expiresIn: 86400 // 24 hours
    });

    res.status(200).json({ auth: true, token });
  });
});

// File upload endpoint
app.post('/api/files/upload', verifyToken, upload.single('pdfFile'), (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).send({ message: 'Please upload a file.' });
  }

  fs.readFile('db.json', 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Error reading database' });
    }

    const db = JSON.parse(data);
    const newFile = {
      id: db.files.length > 0 ? Math.max(...db.files.map(f => f.id)) + 1 : 1,
      userId: req.userId,
      filename: file.originalname,
      path: file.path,
      uploadDate: new Date(),
    };

    db.files.push(newFile);

    fs.writeFile('db.json', JSON.stringify(db, null, 2), (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Error saving file metadata' });
      }

      res.status(200).json({ message: 'File uploaded successfully', file: newFile });
    });
  });
});

// Get user files endpoint
app.get('/api/files', verifyToken, (req, res) => {
  fs.readFile('db.json', 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Error reading database' });
    }

    const db = JSON.parse(data);
    const userFiles = db.files.filter(file => file.userId === req.userId);

    res.status(200).json(userFiles);
  });
});

app.get('/', (req, res) => {
  res.send('Backend server is running!');
});

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
