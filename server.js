const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const bodyParser = require("body-parser");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");
const { type } = require("os");

// Initialize Express app
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use("/uploads", express.static("uploads")); // Serve static profile images

// JWT secret key
const JWT_SECRET =
  "7d0c897bd7be91a8746e5eb48b80401c91b1b825babd707dfca47f6a92909025";

// MongoDB connection
mongoose
  .connect("mongodb://localhost:27017/eliteApp", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));


const storage = multer.diskStorage({
  destination: "./uploads/",
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

// File filter to allow only images
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed!"), false);
  }
};

const upload = multer({ storage, fileFilter });
// Models
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    role: { type: String, required: true },
    password: { type: String, required: true },
    mail: { type: String },
    qualification: { type: String },
    location: { type: String },
    profileImage: { type: String },
    contact: { type: String },
    bio: { type: String },
    registrationDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
const User = mongoose.model("User", userSchema);

const activitySchema = new mongoose.Schema({
  description: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
});
const Activity = mongoose.model("Activity", activitySchema);

let systemStatus = "Online"; // System status
const assessmentSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  code: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  questions: [
    {
      type: { type: String, required: true },
      question: { type: String, required: true },
      options: { type: [String], default: [] },
      correctAnswer: { type: String, default: "" },
      keywords: { type: [String], default: [] },
      description: { type: String, default: "" },
      testCases: [
        {
          input: { type: String, required: true },
          output: { type: String, required: true },
        },
      ],
    },
  ],
});

const Assessment = mongoose.model("Assessment", assessmentSchema);

const responseSchema = new mongoose.Schema({
  assessmentId: { type: String, required: true },
  userId: { type: String, required: true },
  answers: [{ questionId: String, answer: String }],
  submittedAt: { type: Date, default: Date.now },
});
const Response = mongoose.model("Response", responseSchema);


// Middleware for JWT authentication
const authMiddleware = (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ msg: "No token, authorization denied" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded.user; // Ensure this includes an ID field

    next();
  } catch (err) {
    console.error("Middleware error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
};


// Routes
// User Signup
app.post("/signup", async (req, res) => {
  const { name, email, role, password, confirmPassword } = req.body;

  // Check if password and confirm password match
  if (password !== confirmPassword) {
    return res.status(400).json({ msg: "Passwords do not match" });
  }

  try {
    // Check for existing user
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ msg: "User already exists" });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a new user
    const newUser = new User({ name, email, role, password: hashedPassword });

    // Save the user and activity log
    const savedUser = await newUser.save();
    const activity = new Activity({
      description: `User ${name} registered.`,
      userId: savedUser._id,
    });

    await activity.save();

    // Return success response
    res.status(201).json({ msg: "User registered successfully" });
  } catch (err) {
    console.error("Error creating user:", err.message); // Log error for debugging
    res.status(500).json({ msg: "Error creating user", error: err.message });
  }
});
// User Login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ msg: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

    const token = jwt.sign({ user: { id: user._id } }, JWT_SECRET, {
      expiresIn: "1h",
    });

    await new Activity({
      description: `User ${user.name} logged in.`,
      userId: user._id,
    }).save();

    res.json({ token, role: user.role });
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// User Logout
app.post("/logout", authMiddleware, async (req, res) => {
  try {
    await new Activity({
      description: `User ${req.user.name} logged out.`,
      userId: req.user.id,
    }).save();
    res.json({ msg: "Logged out successfully" });
  } catch (err) {
    res.status(500).json({ msg: "Error logging out", error: err.message });
  }
});

// Fetch All Users (Exclude Passwords)
app.get("/users", async (req, res) => {
  try {
    const users = await User.find({}, { password: 0 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching users", error: err.message });
  }
});

app.get("/uploads/:filename", (req, res) => {
  const { filename } = req.params;
  res.sendFile(path.join(__dirname, "../uploads", filename));
});


app.put(
  "/user/update",
  authMiddleware, // Verify JWT token
  upload.single("profileImage"), // Handle profile image upload
  async (req, res) => {
    try {
      const userId = req.user.id; // User ID from JWT token
      const { contact, bio, mail, qualification, location } = req.body;
      const updates = { contact, bio, mail, qualification, location };

      // Check if a profile image was uploaded
      if (req.file) {
        updates.profileImage = `/uploads/${req.file.filename}`;
      }

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $set: updates },
        { new: true }
      ).select("-password"); // Exclude password from response

      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user profile:", error.message);
      res
        .status(500)
        .json({ msg: "Error updating profile", error: error.message });
    }
  }
);
// Delete User
app.delete("/users/:id", authMiddleware, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ msg: "User not found" });

    await new Activity({
      description: `User ${user.name} was deleted.`,
      userId: user._id,
    }).save();
    res.status(204).send(); // No content to send back
  } catch (err) {
    res.status(500).json({ msg: "Error deleting user", error: err.message });
  }
});

// Update User Profile
app.put("/users/:id", authMiddleware, async (req, res) => {
  const userId = req.params.id;
  const { currentPassword, ...updates } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: "User not found" });

    // Check current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch)
      return res.status(400).json({ msg: "Incorrect current password" });

    // Handle updating user
    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 10); // Hash new password if provided
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true }
    ).select("-password");

    await new Activity({
      description: `User ${updatedUser.name} updated their profile.`,
      userId: updatedUser._id,
    }).save();
    res.json(updatedUser);
  } catch (err) {
    res.status(500).json({ msg: "Error updating profile", error: err.message });
  }
});




// Get Recent Activities
app.get("/activities", async (req, res) => {
  try {
    const activities = await Activity.find().sort({ createdAt: -1 }).limit(5);
    res.json(activities);
  } catch (err) {
    res
      .status(500)
      .json({ msg: "Error fetching activities", error: err.message });
  }
});

// System Status
app.get("/status", (req, res) => {
  res.json({ status: systemStatus });
});

// Get Current User
app.get("/user/me", authMiddleware, async (req, res) => {
  try {
    // Fetch the user based on the ID from the token
    const user = await User.findById(req.user.id).select("-password"); // Exclude password from response
    if (!user) return res.status(404).json({ msg: "User not found" });
    res.json(user); // This should include name and role
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// Update System Status
app.post("/status/update", (req, res) => {
  systemStatus = req.body.status || systemStatus;
  res.json({ msg: "System status updated", status: systemStatus });
});
const generateAssessmentCode = () => {
  return `ASSESS-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
};

// POST endpoint to create a new assessment


app.get("/api/assessments", authMiddleware, async (req, res) => {
  try {
    // Filter assessments by userId
    const assessments = await Assessment.find({ userId: req.userId });
    res.json(assessments);
  } catch (error) {
    res.status(500).json({ message: "Error fetching assessments", error });
  }
});

// Updated backend route
app.post('/api/assessments',authMiddleware, async (req, res) => {
  const { id, title, code, questions } = req.body;

  // Validate request body
  if (!id || !title || !code || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ message: 'Assessment data is missing.' });
  }

  try {
    // Create a new assessment with the associated userId
    const newAssessment = new Assessment({
      id,
      title,
      code,
      questions,
      userId:req.user.id, // Associate the assessment with the user
    });
    await newAssessment.save();
    return res.status(201).json(newAssessment);
  } catch (error) {
    console.error('Error saving assessment:', error);
    return res.status(500).json({ message: 'Error saving assessment.' });
  }
});


// GET endpoint to retrieve all assessments



app.get("/api/assessments/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const assessment = await Assessment.findOne({ code }).populate("questions"); // Populate if questions are in a separate model

    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found" });
    }

    res.json({
      id: assessment.id,
      title: assessment.title,
      code: assessment.code,
      createdBy: assessment.createdBy,
      questions: assessment.questions || [], // Ensure questions are included
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
});


// Submit short answer or multiple-choice
// POST route to submit answers
// POST route to submit answers
app.post("/api/assessments/submit", async (req, res) => {
  const { assessmentId, userId, answers } = req.body;

  // Ensure answers are in the correct format
  const formattedAnswers = answers.map(answer => {
    return {
      questionId: answer.questionId, // Make sure to include questionId
      answer: answer.answer // This should be the user's answer
    };
  });

  try {
    // Create a new response document
    const response = new Response({
      assessmentId,
      userId,
      answers: formattedAnswers // Use formatted answers
    });

    // Save the response to the database
    await response.save();
    res.status(200).json({ message: "Submission successful" });
  } catch (error) {
    console.error("Error saving submission:", error);
    res.status(500).json({ message: "Error saving submission", error: error.message });
  }
});

app.post("/api/upload", upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded." }); // Always return JSON
    }

    // If file is uploaded successfully
    return res.status(200).json({
      message: "Image uploaded successfully",
      filePath: `/uploads/${req.file.filename}`,
    });
  } catch (error) {
    return res.status(500).json({ }); // Always return JSON on errors
  }
});


// GET endpoint to retrieve all assessments for the authenticated user
app.get("/api/assessments", authMiddleware, async (req, res) => {
  try {
    const assessments = await Assessment.find({ userId: req.user.id }).populate('questions');
    res.json(assessments);
  } catch (error) {
    console.error("Error fetching assessments:", error);
    res.status(500).json({ message: "Error fetching assessments", error: error.message });
  }
});

// Serve static files from the uploads folder
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.delete("/api/assessments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const assessment = await Assessment.findByIdAndDelete(id);
    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found" });
    }
    res.status(200).json({ message: "Assessment deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting assessment", error });
  }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
