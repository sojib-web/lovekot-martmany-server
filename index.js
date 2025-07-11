// @ts-nocheck
require("dotenv").config(); // Load environment variables

const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// MongoDB connection URI from environment variables
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fhhak4d.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create MongoClient with API versioning
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let SuccessStories;
let ProfileCollection;
let UsersCollection;
let FavouritesCollection;
let ContactRequestCollection;

async function run() {
  try {
    // Connect to MongoDB
    await client.connect();

    const database = client.db("matrimonyBD");
    ProfileCollection = database.collection("profile");
    SuccessStories = database.collection("SuccessStories");
    UsersCollection = database.collection("users");
    FavouritesCollection = database.collection("favourites");
    ContactRequestCollection = database.collection("contactRequests");

    await client.db("admin").command({ ping: 1 });
    console.log("✅ MongoDB connected successfully!");

    // POST: Create Stripe Payment Intent
    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100, // Stripe uses cents
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.error("Stripe error:", error);
        res.status(500).json({ error: "Stripe payment failed" });
      }
    });

    // Inside your Express app setup file, e.g. index.js or server.js
    app.post("/contact-requests", async (req, res) => {
      try {
        const { biodataId, userEmail, transactionId, status } = req.body;

        // Validate required fields
        if (!biodataId || !userEmail || !transactionId) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        const newRequest = {
          biodataId,
          userEmail,
          status: status || "pending", // default to pending if not provided
          transactionId,
          requestedAt: new Date(),
        };

        const result = await ContactRequestCollection.insertOne(newRequest);

        res.status(201).json({
          message: "Contact request submitted",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Error saving contact request:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Get all success stories
    app.get("/api/success-stories", async (req, res) => {
      try {
        const successStories = await SuccessStories.find()
          .sort({ marriageDate: -1 })
          .toArray();
        res.json(successStories);
      } catch (err) {
        console.error("Error fetching success stories:", err);
        res.status(500).json({
          error: "Failed to fetch success stories",
          message: err.message,
        });
      }
    });

    // Get user by email
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const user = await UsersCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        res.json(user);
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Create new user
    app.post("/users", async (req, res) => {
      try {
        console.log("📥 Incoming user data:", req.body);

        const userData = req.body;
        const existingUser = await UsersCollection.findOne({
          email: userData.email,
        });

        if (existingUser) {
          return res.status(400).json({ message: "User already exists" });
        }

        const result = await UsersCollection.insertOne(userData);
        res.status(201).json({
          message: "✅ User created successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("❌ Error creating user:", error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // Create a new success story
    app.post("/api/success-stories", async (req, res) => {
      try {
        const { coupleImage, marriageDate, rating, successStory } = req.body;

        if (!coupleImage || !marriageDate || !rating || !successStory) {
          return res.status(400).json({ error: "Missing required fields" });
        }

        const newSuccessStory = {
          coupleImage,
          marriageDate: new Date(marriageDate),
          rating,
          successStory,
        };

        const result = await SuccessStories.insertOne(newSuccessStory);

        if (result.insertedId) {
          return res.status(201).json({
            message: "Success story created successfully!",
            successStory: newSuccessStory,
            insertedId: result.insertedId,
          });
        } else {
          return res
            .status(500)
            .json({ error: "Failed to create success story" });
        }
      } catch (err) {
        console.error(err);
        return res.status(500).json({
          error: "Failed to create success story",
          details: err.message,
        });
      }
    });

    // Get all profiles
    app.get("/profiles", async (req, res) => {
      try {
        const profiles = await ProfileCollection.find().toArray();
        res.json(profiles);
      } catch (error) {
        console.error("Failed to fetch profiles", error);
        res.status(500).json({ error: "Failed to fetch profiles" });
      }
    });

    // Insert a profile
    app.post("/profile", async (req, res) => {
      console.log(req.body);
      try {
        const data = req.body;
        const result = await ProfileCollection.insertOne(data);
        res.status(201).json({
          message: "✅ Data inserted successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        res.status(500).json({ message: "❌ Failed to insert data", error });
      }
    });

    // Get single biodata by id
    app.get("/biodata/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const biodata = await ProfileCollection.findOne({ id: Number(id) });
        if (!biodata) {
          return res.status(404).json({ message: "Biodata not found" });
        }
        res.json(biodata);
      } catch (err) {
        console.error("Error fetching biodata:", err);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Get , limited to 3
    app.get("/biodata", async (req, res) => {
      try {
        const { type } = req.query;
        let query = {};
        if (type) {
          query.type = { $regex: new RegExp(`^${type}$`, "i") };
        }

        const result = await ProfileCollection.find(query).limit(3).toArray();
        res.json(result);
      } catch (err) {
        console.error("Error fetching biodata by type:", err);
        res.status(500).json({ error: "Failed to fetch biodata" });
      }
    });

    // Get premium profiles sorted and limited
    app.get("/premium-profiles", async (req, res) => {
      try {
        const order = req.query.order === "desc" ? -1 : 1;
        const limit = parseInt(req.query.limit);

        let cursor = ProfileCollection.find().sort({ age: order });

        if (!isNaN(limit) && limit > 0) {
          cursor = cursor.limit(limit);
        }

        const profiles = await cursor.toArray();
        res.json(profiles);
      } catch (err) {
        res.status(500).json({ error: "Failed to fetch profiles" });
      }
    });

    // Success counter API
    app.get("/api/success-counter", async (req, res) => {
      try {
        const totalProfiles = await ProfileCollection.estimatedDocumentCount();
        const boysCount = await ProfileCollection.countDocuments({
          type: { $regex: /^male$/i },
        });
        const girlsCount = await ProfileCollection.countDocuments({
          type: { $regex: /^female$/i },
        });

        const marriagesCount = await SuccessStories.estimatedDocumentCount();

        res.json({
          totalProfiles,
          boysCount,
          girlsCount,
          marriagesCount,
        });
      } catch (err) {
        console.error("Error in counter API:", err);
        res.status(500).json({ error: "Failed to load counter data" });
      }
    });

    // *** NEW: POST /favourites - add biodata to favourites ***
    app.post("/favourites", async (req, res) => {
      try {
        const { biodataId, userEmail } = req.body;

        if (!biodataId || !userEmail) {
          return res.status(400).json({
            message: "Both biodataId and userEmail are required",
          });
        }

        // Check if already in favourites
        const alreadyFav = await FavouritesCollection.findOne({
          biodataId,
          userEmail,
        });

        if (alreadyFav) {
          return res.status(400).json({
            message: "This biodata is already in your favourites",
          });
        }

        // Insert into favourites
        const result = await FavouritesCollection.insertOne({
          biodataId,
          userEmail,
          addedAt: new Date(),
        });

        res.status(201).json({
          message: "Successfully added to favourites",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Error adding favourite:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}

run();
