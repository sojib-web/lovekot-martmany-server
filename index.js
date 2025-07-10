// @ts-nocheck
require("dotenv").config(); // Load environment variables

const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Construct URI using dotenv variables
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fhhak4d.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let SuccessStories;
let ProfileCollection;

async function run() {
  try {
    // Connect the client to the server (this only happens once at server startup)
    await client.connect();

    const database = client.db("matrimonyBD");
    ProfileCollection = database.collection("profile");
    SuccessStories = database.collection("SuccessStories");

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("✅ MongoDB connected successfully!");

    // GET all success stories
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

    // POST endpoint to create a new success story
    app.post("/api/success-stories", async (req, res) => {
      try {
        const { coupleImage, marriageDate, rating, successStory } = req.body;

        // Validate data
        if (!coupleImage || !marriageDate || !rating || !successStory) {
          return res.status(400).json({ error: "Missing required fields" });
        }

        // Create a new success story object
        const newSuccessStory = {
          coupleImage,
          marriageDate: new Date(marriageDate), // Ensure marriageDate is a Date object
          rating,
          successStory,
        };

        // Insert into the SuccessStories collection
        const result = await SuccessStories.insertOne(newSuccessStory);

        // Check if insertion was successful
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

    app.get("/profiles", async (req, res) => {
      try {
        const profiles = await ProfileCollection.find().toArray();
        res.json(profiles);
      } catch (error) {
        console.error("Failed to fetch profiles", error);
        res.status(500).json({ error: "Failed to fetch profiles" });
      }
    });

    // Example POST route to insert data into MongoDB
    app.post("/profile", async (req, res) => {
      console.log(req.body); // Log the incoming data
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

    // GET /premium-profiles?order=asc&limit=6
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

    // Start the server after successful MongoDB connection
    app.listen(PORT, () => {
      console.log(`🚀 Server is running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}

run();
