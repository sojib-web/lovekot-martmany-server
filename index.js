// @ts-nocheck
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Firebase Admin initialization
const serviceAccount = require(path.join(
  __dirname,
  "config",
  "loveknot-verifyFBToken.json"
));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fhhak4d.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Collections
let SuccessStories,
  ProfileCollection,
  UsersCollection,
  FavouritesCollection,
  ContactRequestCollection;

// Middleware: Firebase Token Verification
const verifyFBToken = async (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    console.log("⛔ No Authorization header");
    return res.status(401).send({ message: "Unauthorized" });
  }

  const token = authorization.split(" ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    console.log("✅ Token verified for uid:", decoded.uid);
    req.decoded = decoded;
    next();
  } catch (error) {
    console.error("❌ Token verification failed:", error.message);
    return res.status(401).send({ message: "Unauthorized" });
  }
};

const verifyAdmin = async (req, res, next) => {
  const email = req.decoded?.email;

  if (!email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = await UsersCollection.findOne({ email });

  if (user?.role !== "premium") {
    return res.status(403).json({ message: "Forbidden: Admins only" });
  }

  next();
};

async function getPaginatedData(collection, req, res, query = {}) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // মোট ডকুমেন্টস (query দিয়ে filter দিলে filter count)
    const total = await collection.countDocuments(query);

    // ডাটা fetch
    const data = await collection.find(query).skip(skip).limit(limit).toArray();

    res.json({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data,
    });
  } catch (error) {
    console.error("Pagination error:", error);
    res.status(500).json({ message: "Pagination failed" });
  }
}

async function run() {
  try {
    await client.connect();

    const db = client.db("matrimonyBD");
    ProfileCollection = db.collection("profile");
    SuccessStories = db.collection("SuccessStories");
    UsersCollection = db.collection("users");
    FavouritesCollection = db.collection("favourites");
    ContactRequestCollection = db.collection("contactRequests");

    await client.db("admin").command({ ping: 1 });
    console.log("✅ MongoDB connected successfully!");

    // --- User Routes ---

    app.post("/users", async (req, res) => {
      console.log("POST /users called with body:", req.body);
      const userData = req.body;
      const existingUser = await UsersCollection.findOne({
        email: userData.email.toLowerCase(),
      });
      if (existingUser) {
        console.log(`User already exists: ${userData.email}`);
        return res.status(400).json({ message: "User already exists" });
      }
      const result = await UsersCollection.insertOne(userData);
      console.log("User created with id:", result.insertedId);
      res.status(201).json({
        message: "✅ User created successfully",
        insertedId: result.insertedId,
      });
    });

    // ✅ GET /users with pagination, search, and premiumRequested
    app.get("/users", verifyFBToken, verifyAdmin, async (req, res) => {
      console.log("GET /users called");

      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || "";

        const skip = (page - 1) * limit;

        // Filter: Search by name or email (case insensitive)
        const query = {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ],
        };

        const total = await UsersCollection.countDocuments(query);

        const users = await UsersCollection.find(query)
          .skip(skip)
          .limit(limit)
          .toArray();

        // Attach premiumRequested flag from profile collection
        const updatedUsers = await Promise.all(
          users.map(async (user) => {
            const profile = await ProfileCollection.findOne({
              contactEmail: user.email,
            });
            return {
              ...user,
              premiumRequested: profile?.premiumRequested || false,
            };
          })
        );

        res.json({
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          data: updatedUsers,
        });
      } catch (error) {
        console.error("GET /users error:", error.message);
        res.status(500).json({ message: "Failed to fetch users" });
      }
    });

    // GET /users/role/:email
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email.toLowerCase(); // ✅ case insensitive

      const user = await UsersCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ role: null });
      }

      res.send({ role: user.role });
    });

    app.get("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await UsersCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        res.json(user);
      } catch (error) {
        console.error("GET /users/:email error:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // PATCH /users/:id/make-admin  --> **Protected**
    app.patch(
      "/users/:id/make-admin",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        console.log(`PATCH /users/${id}/make-admin called`);
        try {
          const result = await UsersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role: "admin" } }
          );
          console.log("User role updated:", result.modifiedCount);
          res.json({
            message: "User role updated to admin",
            modifiedCount: result.modifiedCount,
          });
        } catch (error) {
          console.error("❌ Error updating role:", error);
          res.status(500).json({ message: "Failed to update role" });
        }
      }
    );

    // PATCH /users/:id/make-premium  --> **Protected**
    app.patch(
      "/users/:id/make-premium",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const userId = req.params.id;
        console.log(`PATCH /users/${userId}/make-premium called`);
        try {
          const user = await UsersCollection.findOne({
            _id: new ObjectId(userId),
          });
          if (!user) {
            console.log(`User not found: ${userId}`);
            return res.status(404).json({ message: "User not found" });
          }

          // Check if user is already premium
          if (user.role === "premium") {
            console.log(`User ${user.email} is already premium`);
            return res.status(400).json({ message: "User is already premium" });
          }

          const profile = await ProfileCollection.findOne({
            contactEmail: user.email,
          });
          if (!profile || profile.premiumRequested !== true) {
            console.log(
              `Premium not requested or profile missing for user: ${user.email}`
            );
            return res.status(400).json({
              message: "User's profile has not requested premium",
            });
          }

          await UsersCollection.updateOne(
            { _id: new ObjectId(userId) },
            { $set: { role: "premium" } }
          );
          await ProfileCollection.updateOne(
            { contactEmail: user.email },
            { $set: { premiumApproved: true } }
          );

          console.log(`User ${user.email} made premium successfully`);
          res.json({ message: "User has been made premium successfully" });
        } catch (err) {
          console.error("🔥 Error making user premium:", err);
          res.status(500).json({ message: "Internal server error" });
        }
      }
    );

    // --- Profile Routes ---

    // POST /profile  --> **Protected**
    app.post("/profile", verifyFBToken, async (req, res) => {
      console.log("POST /profile called with data:", req.body);
      const data = req.body;
      const lastData = await ProfileCollection.find()
        .sort({ biodataId: -1 })
        .limit(1)
        .toArray();
      const lastId = lastData[0]?.biodataId || 0;
      data.biodataId = lastId + 1;
      const result = await ProfileCollection.insertOne(data);
      console.log("Biodata created with id:", result.insertedId);
      res.status(201).json({
        message: "✅ Biodata created successfully",
        insertedId: result.insertedId,
        biodataId: data.biodataId,
      });
    });

    // PATCH /profile/premium-request/:id  --> **Protected**
    app.patch(
      "/profile/premium-request/:id",
      verifyFBToken,
      async (req, res) => {
        const id = req.params.id;
        console.log(`PATCH /profile/premium-request/${id} called`);
        const result = await ProfileCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { premiumRequested: true } }
        );
        console.log("Premium requested flag updated:", result.modifiedCount);
        res.send(result);
      }
    );

    app.get("/profile/:email", async (req, res) => {
      console.log("GET /profile/:email called with email:", req.params.email);
      const email = req.params.email;
      const biodata = await ProfileCollection.findOne({ contactEmail: email });
      if (!biodata) {
        console.log(`Biodata not found for email: ${email}`);
        return res.status(404).json({ message: "Biodata not found" });
      }
      res.json(biodata);
    });

    app.get("/profiles", async (req, res) => {
      console.log("GET /profiles called");
      const profiles = await ProfileCollection.find().toArray();
      res.json(profiles);
    });

    app.get("/biodata", async (req, res) => {
      console.log("GET /biodata called with query:", req.query);
      const { type } = req.query;
      const query = type
        ? { type: { $regex: new RegExp(`^${type}$`, "i") } }
        : {};
      const result = await ProfileCollection.find(query).limit(3).toArray();
      res.json(result);
    });

    app.get("/biodata/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid biodata id" });
        }
        const biodata = await ProfileCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!biodata) {
          return res.status(404).json({ message: "Biodata not found" });
        }
        res.json(biodata);
      } catch (error) {
        console.error("GET /biodata/:id error:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/biodata-by-id/:id", async (req, res) => {
      console.log("GET /biodata-by-id/:id called with id:", req.params.id);
      const id = parseInt(req.params.id);
      const result = await ProfileCollection.findOne({ biodataId: id });
      res.send(result);
    });

    // ✅ routes/premiumProfiles.js (or inside server.js)
    app.get("/premium-profiles", async (req, res) => {
      try {
        // Get order and limit from query params
        const order = req.query.order === "desc" ? -1 : 1; // default ascending
        const limit = parseInt(req.query.limit) || 8;

        // Query for only premium approved profiles
        const query = { premiumApproved: true };

        // If your age is stored as string, convert using aggregation pipeline
        const result = await ProfileCollection.aggregate([
          { $match: query },
          {
            $addFields: {
              ageNum: { $toInt: "$age" }, // convert age string to int
            },
          },
          { $sort: { ageNum: order } },
          { $limit: limit },
        ]).toArray();

        res.send(result);
      } catch (error) {
        console.error("❌ Error fetching premium profiles:", error.message);
        res.status(500).send({ message: "Server Error" });
      }
    });
    // --- Dashboard and Admin Stats ---

    // GET /dashboard/approvedPremium  --> **Protected**

    app.get("/dashboard/approvedPremium", verifyFBToken, async (req, res) => {
      console.log("GET /dashboard/approvedPremium called");

      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const matchStage = { premiumRequested: true };

        const total = await ProfileCollection.countDocuments(matchStage);

        // Aggregation pipeline with pagination
        const result = await ProfileCollection.aggregate([
          { $match: matchStage },
          {
            $lookup: {
              from: "users",
              localField: "contactEmail",
              foreignField: "email",
              as: "userInfo",
            },
          },
          { $unwind: "$userInfo" },
          {
            $project: {
              name: "$userInfo.name",
              email: "$userInfo.email",
              _id: "$userInfo._id",
              biodataId: 1,
            },
          },
          { $skip: skip },
          { $limit: limit },
        ]).toArray();

        const totalPages = Math.ceil(total / limit);

        res.json({
          data: result,
          total,
          page,
          limit,
          totalPages,
        });
      } catch (err) {
        console.error("❌ Error in approvedPremium route:", err.message);
        res.status(500).send({ message: "Server Error" });
      }
    });

    // GET /admin-dashboard/stats  --> **Protected**
    app.get("/admin-dashboard/stats", verifyFBToken, async (req, res) => {
      console.log("GET /admin-dashboard/stats called");
      try {
        const totalBiodata = await ProfileCollection.countDocuments();
        const maleCount = await ProfileCollection.countDocuments({
          biodataType: "Male",
        });
        const femaleCount = await ProfileCollection.countDocuments({
          biodataType: "Female",
        });
        const premiumCount = await ProfileCollection.countDocuments({
          premiumRequested: true,
        });
        const requests = await ContactRequestCollection.find({
          status: "approved",
        }).toArray();
        const totalRevenue = requests.reduce(
          (sum, r) => sum + (r.amountPaid || 0),
          0
        );
        res.json({
          totalBiodata,
          maleCount,
          femaleCount,
          premiumCount,
          totalRevenue,
        });
      } catch (err) {
        console.error("❌ Error fetching admin stats:", err.message);
        res
          .status(500)
          .json({ message: "Error fetching admin stats", error: err.message });
      }
    });

    // --- Contact Requests ---

    app.get(
      "/contact-requests",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const page = parseInt(req.query.page) || 1;
          const limit = parseInt(req.query.limit) || 10;
          const skip = (page - 1) * limit;

          const total = await ContactRequestCollection.countDocuments();
          const requests = await ContactRequestCollection.find()
            .sort({ requestedAt: -1 }) // যদি requestedAt না থাকে, _id এর descending ব্যবহার করতে পারো
            .skip(skip)
            .limit(limit)
            .toArray();

          res.json({
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            data: requests, // এখানে অবশ্যই data নামে অ্যারে দিতে হবে
          });
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: "Failed to fetch contact requests" });
        }
      }
    );

    // GET /contact-requests/:email  --> **Protected**
    app.get("/contact-requests/:email", verifyFBToken, async (req, res) => {
      console.log(
        "GET /contact-requests/:email called with email:",
        req.params.email
      );

      const userEmail = req.params.email;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      try {
        // Count total contact requests for this user
        const total = await ContactRequestCollection.countDocuments({
          userEmail,
        });

        // Aggregate with lookup, unwind, project, and pagination
        const requests = await ContactRequestCollection.aggregate([
          { $match: { userEmail } },
          {
            $lookup: {
              from: "profile",
              localField: "biodataId",
              foreignField: "biodataId",
              as: "profileData",
            },
          },
          {
            $unwind: { path: "$profileData", preserveNullAndEmptyArrays: true },
          },
          {
            $project: {
              _id: 1,
              biodataId: 1,
              status: 1,
              name: "$profileData.name",
              mobileNumber: "$profileData.mobileNumber",
              contactEmail: "$profileData.contactEmail",
            },
          },
          { $skip: skip },
          { $limit: limit },
        ]).toArray();

        res.json({
          data: requests,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        });
      } catch (error) {
        console.error("Error fetching contact requests:", error);
        res.status(500).json({ error: "Failed to fetch contact requests" });
      }
    });

    // POST /contact-requests  --> **Protected**
    app.post("/contact-requests", verifyFBToken, async (req, res) => {
      console.log("POST /contact-requests called with body:", req.body);
      const { userEmail, biodataId, transactionId, amountPaid } = req.body;
      const profileDoc = await ProfileCollection.findOne({
        _id: new ObjectId(biodataId),
      });
      if (!profileDoc) {
        console.log(
          "Biodata not found for contact request, biodataId:",
          biodataId
        );
        return res.status(404).json({ error: "Biodata not found" });
      }

      const newRequest = {
        userEmail,
        biodataId: profileDoc.biodataId,
        transactionId,
        amountPaid: amountPaid || 0,
        status: "pending",
        name: profileDoc.name || "N/A",
        mobileNumber: profileDoc.mobileNumber || "N/A",
        contactEmail: profileDoc.contactEmail || "N/A",
        requestedAt: new Date(),
      };

      const result = await ContactRequestCollection.insertOne(newRequest);
      console.log("Contact request created with id:", result.insertedId);
      res.json(result);
    });

    // Approve contact request
    app.patch(
      "/contact-requests/approve/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        try {
          const result = await ContactRequestCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "approved" } }
          );

          if (result.modifiedCount === 0) {
            return res
              .status(404)
              .json({ error: "Request not found or already approved" });
          }

          res.json({ success: true, message: "Contact request approved" });
        } catch (error) {
          console.error("Error approving contact request:", error);
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );

    // DELETE /contact-requests/:id  --> **Protected**
    app.delete("/contact-requests/:id", verifyFBToken, async (req, res) => {
      console.log(
        "DELETE /contact-requests/:id called with id:",
        req.params.id
      );
      const id = req.params.id;
      const result = await ContactRequestCollection.deleteOne({
        _id: new ObjectId(id),
      });
      console.log("Contact request deleted count:", result.deletedCount);
      res.send(result);
    });

    app.get("/favourites", verifyFBToken, async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res
            .status(400)
            .json({ message: "Email query parameter is required" });
        }

        const favourites = await FavouritesCollection.find({
          userEmail: email,
        }).toArray();
        res.json(favourites);
      } catch (error) {
        console.error("Error fetching favourites:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // GET /favourites  --> **Protected**
    app.post("/favourites", verifyFBToken, async (req, res) => {
      try {
        const {
          biodataUniqueId,
          name,
          permanentAddress,
          occupation,
          userEmail,
        } = req.body;
        if (!biodataUniqueId || !userEmail) {
          return res.status(400).json({ message: "Required fields missing" });
        }

        const existing = await FavouritesCollection.findOne({
          biodataUniqueId,
          userEmail,
        });
        if (existing) {
          return res
            .status(400)
            .json({ message: "Already added to favourites" });
        }

        const result = await FavouritesCollection.insertOne({
          biodataUniqueId,
          name,
          permanentAddress,
          occupation,
          userEmail,
          createdAt: new Date(),
        });
        res.status(201).json({
          message: "Added to favourites",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("POST /favourites error:", error);
        res.status(500).json({ message: "Server error" });
      }
    });
    // DELETE /favourites/:id  --> **Protected**
    app.delete("/favourites/:id", verifyFBToken, async (req, res) => {
      console.log("DELETE /favourites/:id called with id:", req.params.id);
      const id = req.params.id;
      const result = await FavouritesCollection.deleteOne({
        _id: new ObjectId(id),
      });
      console.log("Favourite deleted count:", result.deletedCount);
      res.send(result);
    });

    // --- Stripe Payment Intent ---

    // POST /create-payment-intent  --> **Protected** (Optional but recommended)
    app.post("/create-payment-intent", verifyFBToken, async (req, res) => {
      console.log("POST /create-payment-intent called with body:", req.body);
      const { amount } = req.body;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100,
          currency: "usd",
          payment_method_types: ["card"],
        });
        console.log("Stripe payment intent created");
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error("Stripe error:", err);
        res.status(500).json({ error: "Stripe payment failed" });
      }
    });

    // --- Success Stories ---

    app.get("/api/success-stories", async (req, res) => {
      console.log("GET /api/success-stories called");
      const successStories = await SuccessStories.find()
        .sort({ marriageDate: -1 })
        .toArray();
      res.json(successStories);
    });

    // POST /api/success-stories  --> **Protected**
    app.post("/api/success-stories", async (req, res) => {
      console.log("POST /api/success-stories called with body:", req.body);
      const { coupleImage, marriageDate, rating, successStory } = req.body;
      if (!coupleImage || !marriageDate || !rating || !successStory) {
        console.log("Missing required fields for success story");
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
        console.log("Success story created with id:", result.insertedId);
        res.status(201).json({
          message: "Success story created successfully!",
          successStory: newSuccessStory,
          insertedId: result.insertedId,
        });
      } else {
        console.log("Failed to create success story");
        res.status(500).json({ error: "Failed to create success story" });
      }
    });

    // Assuming you're using Express and have ProfileCollection & SuccessStories defined

    app.get("/api/success-counter", async (req, res) => {
      try {
        console.log("📊 GET /api/success-counter called");

        const totalProfiles = await ProfileCollection.estimatedDocumentCount();

        const boysCount = await ProfileCollection.countDocuments({
          biodataType: { $regex: /^male$/i },
        });

        const girlsCount = await ProfileCollection.countDocuments({
          biodataType: { $regex: /^female$/i },
        });

        const marriagesCount = await SuccessStories.estimatedDocumentCount();

        res.json({ totalProfiles, boysCount, girlsCount, marriagesCount });
      } catch (err) {
        console.error("❌ Error in success-counter:", err.message);
        res.status(500).json({ message: "Server Error" });
      }
    });

    // --- Start Server ---
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}

run();
