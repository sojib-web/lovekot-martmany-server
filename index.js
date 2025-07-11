// @ts-nocheck
require("dotenv").config(); // Load environment variables

const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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
          amount: amount * 100,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error("Stripe error:", error);
        res.status(500).json({ error: "Stripe payment failed" });
      }
    });

    // POST: Save contact requests

    app.post("/contact-requests", async (req, res) => {
      const { userEmail, biodataId, transactionId } = req.body;

      try {
        // Convert string to ObjectId if needed
        const profileDoc = await ProfileCollection.findOne({
          _id: new ObjectId(biodataId),
        });

        if (!profileDoc) {
          return res.status(404).json({ error: "Biodata not found" });
        }

        const newRequest = {
          userEmail,
          biodataId: profileDoc.biodataId,
          transactionId,
          status: "pending",
          name: profileDoc.name || "N/A",
          mobileNumber: profileDoc.mobileNumber || "N/A",
          contactEmail: profileDoc.contactEmail || "N/A",
          requestedAt: new Date(),
        };

        const result = await ContactRequestCollection.insertOne(newRequest);
        res.json(result);
      } catch (err) {
        console.error("❌ Failed to insert contact request:", err);
        res.status(500).json({ error: "Failed to insert request" });
      }
    });

    // Express.js উদাহরণ
    // app.get("/contact-requests/:email", async (req, res) => {
    //   const email = req.params.email;
    //   const requests = await ContactRequestCollection.find({
    //     userEmail: email,
    //   });
    //   res.send(requests);
    // });

    // GET: All success stories
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

    // GET: Get user by email
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

    // GET: Get biodata by contact email (added missing route)
    app.get("/profile/:email", async (req, res) => {
      const email = req.params.email;

      try {
        const profiles = await ProfileCollection.find({}).toArray();
        console.log("Profiles in DB:", profiles);

        const biodata = await ProfileCollection.findOne({
          contactEmail: email,
        });

        if (!biodata) {
          return res.status(404).json({ message: "Biodata not found" });
        }

        res.json(biodata);
      } catch (error) {
        console.error("Error fetching biodata by email:", error);
        res.status(500).json({ error: "Server error" });
      }
    });

    // POST: Create new user
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

    // POST: Create success story
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

    // GET: Get all profiles
    app.get("/profiles", async (req, res) => {
      try {
        const profiles = await ProfileCollection.find().toArray();
        res.json(profiles);
      } catch (error) {
        console.error("Failed to fetch profiles", error);
        res.status(500).json({ error: "Failed to fetch profiles" });
      }
    });

    // POST: Create or Update biodata (assign biodataId automatically)
    app.post("/profile", async (req, res) => {
      try {
        const data = req.body;

        const lastData = await ProfileCollection.find()
          .sort({ biodataId: -1 })
          .limit(1)
          .toArray();
        const lastId = lastData[0]?.biodataId || 0;
        const newBiodataId = lastId + 1;

        data.biodataId = newBiodataId;

        const result = await ProfileCollection.insertOne(data);
        res.status(201).json({
          message: "✅ Biodata created successfully",
          insertedId: result.insertedId,
          biodataId: newBiodataId,
        });
      } catch (error) {
        console.error("❌ Error inserting biodata:", error);
        res.status(500).json({ message: "Failed to insert biodata" });
      }
    });

    // GET: Get biodata filtered by type (limit 3)
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

    // GET: Get biodata by id
    app.get("/biodata/:id", async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid biodata id" });
      }

      try {
        const biodata = await ProfileCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!biodata) {
          return res.status(404).json({ message: "Biodata not found" });
        }
        res.json(biodata);
      } catch (err) {
        console.error("Error fetching biodata:", err);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    app.get("/biodata-by-id/:id", async (req, res) => {
      const id = parseInt(req.params.id);
      try {
        const result = await ProfileCollection.findOne({ biodataId: id });
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch biodata by ID" });
      }
    });

    // GET: Get premium profiles sorted by age with optional limit
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

    // GET: Success counter data
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

    // POST: Add biodata to favourites
    app.post("/favourites", async (req, res) => {
      try {
        const { biodataId, userEmail } = req.body;

        if (!biodataId || !userEmail) {
          return res.status(400).json({
            message: "Both biodataId and userEmail are required",
          });
        }

        const alreadyFav = await FavouritesCollection.findOne({
          biodataId,
          userEmail,
        });

        if (alreadyFav) {
          return res.status(400).json({
            message: "This biodata is already in your favourites",
          });
        }

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

    // PATCH: Request biodata to be premium (fix variable and ObjectId)
    app.patch("/profile/premium-request/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const result = await ProfileCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { premiumRequested: true } }
        );
        res.send(result);
      } catch (err) {
        res
          .status(500)
          .json({ message: "Failed to request premium", error: err });
      }
    });

    // ✅ GET: Get contact requests for logged-in user
    app.get("/contact-requests/:email", async (req, res) => {
      const userEmail = req.params.email;

      try {
        const requests = await ContactRequestCollection.aggregate([
          { $match: { userEmail } },
          {
            $lookup: {
              from: "profile", // তোমার প্রোফাইল কালেকশন নাম
              localField: "biodataId", // contact_requests এ যে biodataId আছে (eg: 21)
              foreignField: "biodataId", // profile এ সেই ফিল্ড (eg: 21)
              as: "profileData",
            },
          },
          {
            $unwind: { path: "$profileData", preserveNullAndEmptyArrays: true },
          },
          {
            $project: {
              _id: 1,
              biodataId: 1, // এটা আসবে eg: 21
              status: 1,
              name: "$profileData.name",
              mobileNumber: "$profileData.mobileNumber",
              contactEmail: "$profileData.contactEmail",
            },
          },
        ]).toArray();

        res.json(requests);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch contact requests" });
      }
    });

    // ✅ DELETE: Delete a contact request
    app.delete("/contact-requests/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const result = await ContactRequestCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (error) {
        console.error("❌ Failed to delete contact request:", error);
        res.status(500).json({ error: "Failed to delete contact request" });
      }
    });

    // Start the server
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}

run();
