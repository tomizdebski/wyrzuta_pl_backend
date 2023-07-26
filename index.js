require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require("mongoose");
const User = require('./models/User');
const Post = require('./models/Post');
const bcrypt = require('bcryptjs');
const app = express();
const jwt = require('jsonwebtoken');
const cookieParser= require('cookie-parser');
const multer = require('multer');
const fs = require('fs');
const uploadMiddleware = multer({ dest: 'uploads/' });
const salt = bcrypt.genSaltSync(10);
const bodyParser = require('body-parser');
const {body, checkSchema, validationResult} = require('express-validator');

const secret = process.env.SECRET;

app.use(cors({credentials:true,origin:process.env.CORS_ACCEPTED}));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(__dirname + '/uploads'));
app.use(bodyParser.urlencoded({ extended: false }));

mongoose.connect(process.env.MONGO_CONNECT);
const PORT = process.env.PORT || 4000;

const registrationSchema = {
  username: {
      notEmpty: true,
      custom: {
          options: value => {
              return User.find({
                  username: value
              }).then(user => {
                  if (user.length > 0) {
                      return Promise.reject('Username already in use')
                  }
              })
          }
      }
  },
  password: {
    notEmpty: true,
    isLength: { options: { min: 8 } },
    errorMessage: "Password must be greater than 8 ",
  },
  email: {
      notEmpty: true,
      normalizeEmail: true,
      custom: {
          options: value => {
              return User.find({
                  email: value
              }).then(user => {
                  if (user.length > 0) {
                      return Promise.reject('Email address already taken')
                  }
              })
          }
      }
  },
  street: {
    notEmpty: true,
    errorMessage: "Field cannot be empty",
  },
  city: {
    notEmpty: true,
    errorMessage: "Field cannot be empty",
  },
  zip: {
    notEmpty: true,
    errorMessage: "Field cannot be empty",
  },
  trim: true,
  escape: true,
}

const loginSchema = {
  username: {
    notEmpty: true,
    errorMessage: "Field cannot be empty",
  },
  password: {
      notEmpty: true,
      errorMessage: "Field cannot be empty",
  },
  trim: true,
  escape: true,
}

const addPostSchema = {
  title: {
    notEmpty: true,
    errorMessage: "Field cannot be empty",
  },
  summary: {
      notEmpty: true,
      errorMessage: "Field cannot be empty",
  },
  content: {
    notEmpty: true,
    errorMessage: "Field cannot be empty",
  },
  // file: {
  //   notEmpty: true,
  //   errorMessage: "Field cannot be empty",
  // },
  trim: true,
  escape: true,
}

app.post('/register', checkSchema(registrationSchema), async (req,res) => {
    const {username,password,email,street,city,zip} = req.body;

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.status(400).json({
            errors: errors.array()
        });
    }


    try{
      const userDoc = await User.create({
        username,
        password:bcrypt.hashSync(password,salt),
        email,
        street,
        city,
        zip
      });
      res.json(userDoc);
    } catch(e) {
      console.log(e);
      res.status(400).json(e);
    }
  });

app.post('/login', checkSchema(loginSchema), async (req,res) => {

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.status(400).json({
            errors: errors.array()
        });
    }

    const {username,password} = req.body;
    const userDoc = await User.findOne({username});
    if (!userDoc) return res.status(400).json('niema takiego użytkownika');
    const passOk = bcrypt.compareSync(password, userDoc.password);
    if (passOk) {
      // logged in
      jwt.sign({username,id:userDoc._id}, secret, {}, (err,token) => {
        if (err) throw err;
        res.cookie('token', token).json({
          id:userDoc._id,
          username,
        });
      });
    } else {
      res.status(400).json('wrong credentials');
    }
  });

  app.get('/profile', (req,res) => {
    const {token} = req.cookies;
    jwt.verify(token, secret, {}, (err,info) => {
      if (err) throw err;
      res.json(info);
    });
  });
  
  app.post('/logout', (req,res) => {
    res.cookie('token', '').json('ok');
  });
  
  app.post('/post', uploadMiddleware.single('file'), checkSchema(addPostSchema), async (req,res) => {
    const {originalname,path} = req.file;
    const parts = originalname.split('.');
    const ext = parts[parts.length - 1];
    const newPath = path+'.'+ext;
    fs.renameSync(path, newPath);
  
    const {token} = req.cookies;

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.status(400).json({
            errors: errors.array()
        });
    }


    jwt.verify(token, secret, {}, async (err,info) => {
      if (err) throw err;
      const {title,summary,content} = req.body;
      const postDoc = await Post.create({
        title,
        summary,
        content,
        cover:newPath,
        author:info.id,
        buyer: null,
      });
      res.json(postDoc);
    });
  
  });
  
  app.put('/post',uploadMiddleware.single('file'), async (req,res) => {
    let newPath = null;
    if (req.file) {
      const {originalname,path} = req.file;
      const parts = originalname.split('.');
      const ext = parts[parts.length - 1];
      newPath = path+'.'+ext;
      fs.renameSync(path, newPath);
    }
  
    const {token} = req.cookies;
    jwt.verify(token, secret, {}, async (err,info) => {
      if (err) throw err;
      const {id,title,summary,content} = req.body;
      const postDoc = await Post.findById(id);
      const isAuthor = JSON.stringify(postDoc.author) === JSON.stringify(info.id);
      if (!isAuthor) {
        return res.status(400).json('you are not the author');
      }
      await postDoc.update({
        title,
        summary,
        content,
        cover: newPath ? newPath : postDoc.cover,
      });
  
      res.json(postDoc);
    });
  
  });
  
  app.get('/post', async (req,res) => {
    res.json(
      await Post.find()
        .populate('author', ['username'])
        .sort({createdAt: -1})
        .limit(20)
    );
  });
  
  app.get('/post/:id', async (req, res) => {
    const {id} = req.params;
    const postDoc = await Post.findById(id).populate('author', ['username']);
    res.json(postDoc);
  });

  app.put('/buy', async (req,res) => {
   
    const {token} = await req.cookies;
    jwt.verify(token, secret, {}, async (err,info) => {
     
      const {_id, author, title, summary, content} = await req.body;
      const filter = { _id };
      const update = { buyer: info.id };
      const doc = await Post.findOneAndUpdate(filter, update, {
        new: true
      });
      await res.json(`${doc} ${info.id}`);
    });
  });

  app.put('/cancel', async (req,res) => {
   
    const {token} = await req.cookies;
    jwt.verify(token, secret, {}, async (err,info) => {
      const {_id} = await req.body;
      const filter = { _id };
      const update = { buyer: null };
      const doc = await Post.findOneAndUpdate(filter, update, {
        new: true
      });
      await res.json(`${doc} ${info.id}`);
    });
  });

  app.get('/my-orders', async (req,res)=> {
    const {token} = await req.cookies;
    jwt.verify(token, secret, {}, async (err,info) => {
      if (err) throw err;
      const doc = await Post.find({buyer: info.id});
      await res.json(doc);
    });
  })

  
  app.delete('/post/:id', async (req,res) => {
  
    const {id} = req.params;
    const {token} = req.cookies;
    jwt.verify(token, secret, {}, async (err,info) => {
      if (err) throw err;
      const postDoc = await Post.find({_id:id}).findOneAndRemove().exec();
      
      res.json("skasowano");
    });
  
  });

  app.get('/test', async (req,res) => {
    res.json("działa test");
    });

  
  app.listen(PORT);