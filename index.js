// @ts-nocheck
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fhhak4d.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let SuccessStories,
  ProfileCollection,
  UsersCollection,
  FavouritesCollection,
  ContactRequestCollection;

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
      const userData = req.body;
      const existingUser = await UsersCollection.findOne({
        email: userData.email,
      });
      if (existingUser)
        return res.status(400).json({ message: "User already exists" });
      const result = await UsersCollection.insertOne(userData);
      res.status(201).json({
        message: "✅ User created successfully",
        insertedId: result.insertedId,
      });
    });

    app.get("/users", async (req, res) => {
      const search = req.query.search;
      const query = search ? { name: { $regex: search, $options: "i" } } : {};

      const users = await UsersCollection.find(query).toArray();

      // Optional: profile collection theke premiumRequested state add kora
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

      res.send(updatedUsers);
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await UsersCollection.findOne({ email });
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(user);
    });

    // PATCH /users/:id/make-admin
    app.patch("/users/:id/make-admin", async (req, res) => {
      const id = req.params.id;

      try {
        const result = await UsersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: "admin" } }
        );

        res.json({
          message: "User role updated to admin",
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("❌ Error updating role:", error);
        res.status(500).json({ message: "Failed to update role" });
      }
    });

    app.patch("/users/:id/make-premium", async (req, res) => {
      const userId = req.params.id;
      try {
        const user = await UsersCollection.findOne({
          _id: new ObjectId(userId),
        });
        if (!user) return res.status(404).json({ message: "User not found" });
        const profile = await ProfileCollection.findOne({
          contactEmail: user.email,
        });
        if (!profile || profile.premiumRequested !== true)
          return res
            .status(400)
            .json({ message: "User's profile has not requested premium" });

        await UsersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { role: "premium" } }
        );
        await ProfileCollection.updateOne(
          { contactEmail: user.email },
          { $set: { premiumApproved: true } }
        );

        res.json({ message: "User has been made premium successfully" });
      } catch (err) {
        console.error("🔥 Error making user premium:", err);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // --- Profile Routes ---

    app.post("/profile", async (req, res) => {
      const data = req.body;
      const lastData = await ProfileCollection.find()
        .sort({ biodataId: -1 })
        .limit(1)
        .toArray();
      const lastId = lastData[0]?.biodataId || 0;
      data.biodataId = lastId + 1;
      const result = await ProfileCollection.insertOne(data);
      res.status(201).json({
        message: "✅ Biodata created successfully",
        insertedId: result.insertedId,
        biodataId: data.biodataId,
      });
    });

    app.patch("/profile/premium-request/:id", async (req, res) => {
      const id = req.params.id;
      const result = await ProfileCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { premiumRequested: true } }
      );
      res.send(result);
    });

    app.get("/profile/:email", async (req, res) => {
      const email = req.params.email;
      const biodata = await ProfileCollection.findOne({ contactEmail: email });
      if (!biodata)
        return res.status(404).json({ message: "Biodata not found" });
      res.json(biodata);
    });

    app.get("/profiles", async (req, res) => {
      const profiles = await ProfileCollection.find().toArray();
      res.json(profiles);
    });

    app.get("/biodata", async (req, res) => {
      const { type } = req.query;
      const query = type
        ? { type: { $regex: new RegExp(`^${type}$`, "i") } }
        : {};
      const result = await ProfileCollection.find(query).limit(3).toArray();
      res.json(result);
    });

    app.get("/biodata/:id", async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid biodata id" });
      const biodata = await ProfileCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!biodata)
        return res.status(404).json({ message: "Biodata not found" });
      res.json(biodata);
    });

    app.get("/biodata-by-id/:id", async (req, res) => {
      const id = parseInt(req.params.id);
      const result = await ProfileCollection.findOne({ biodataId: id });
      res.send(result);
    });

    app.get("/premium-profiles", async (req, res) => {
      const order = req.query.order === "desc" ? -1 : 1;
      const limit = parseInt(req.query.limit);
      let cursor = ProfileCollection.find().sort({ age: order });
      if (!isNaN(limit) && limit > 0) cursor = cursor.limit(limit);
      const profiles = await cursor.toArray();
      res.json(profiles);
    });

    // --- Dashboard and Admin Stats ---

    app.get("/dashboard/approvedPremium", async (req, res) => {
      try {
        const result = await ProfileCollection.aggregate([
          { $match: { premiumRequested: true } },
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
        ]).toArray();
        res.send(result);
      } catch (err) {
        console.error("❌ Error in approvedPremium route:", err.message);
        res.status(500).send({ message: "Server Error" });
      }
    });

    app.get("/admin-dashboard/stats", async (req, res) => {
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
        res
          .status(500)
          .json({ message: "Error fetching admin stats", error: err.message });
      }
    });

    // --- Contact Requests ---

    app.post("/contact-requests", async (req, res) => {
      const { userEmail, biodataId, transactionId, amountPaid } = req.body;
      const profileDoc = await ProfileCollection.findOne({
        _id: new ObjectId(biodataId),
      });
      if (!profileDoc)
        return res.status(404).json({ error: "Biodata not found" });

      const newRequest = {
        userEmail,
        biodataId: profileDoc.biodataId,
        transactionId,
        amountPaid: amountPaid || 0,
        status: "approved",
        name: profileDoc.name || "N/A",
        mobileNumber: profileDoc.mobileNumber || "N/A",
        contactEmail: profileDoc.contactEmail || "N/A",
        requestedAt: new Date(),
      };

      const result = await ContactRequestCollection.insertOne(newRequest);
      res.json(result);
    });

    app.get("/contact-requests/:email", async (req, res) => {
      const userEmail = req.params.email;
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
        { $unwind: { path: "$profileData", preserveNullAndEmptyArrays: true } },
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
      ]).toArray();
      res.json(requests);
    });

    app.delete("/contact-requests/:id", async (req, res) => {
      const id = req.params.id;
      const result = await ContactRequestCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // --- Favourites ---

    app.post("/favourites", async (req, res) => {
      const {
        biodataId,
        biodataUniqueId,
        name,
        permanentAddress,
        occupation,
        userEmail,
      } = req.body;
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
    });

    app.get("/favourites", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).json({ message: "Email required" });
      const favourites = await FavouritesCollection.find({
        userEmail: email,
      }).toArray();
      res.send(favourites);
    });

    app.delete("/favourites/:id", async (req, res) => {
      const id = req.params.id;
      const result = await FavouritesCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // --- Stripe Payment Intent ---

    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error("Stripe error:", err);
        res.status(500).json({ error: "Stripe payment failed" });
      }
    });

    // --- Success Stories ---

    app.get("/api/success-stories", async (req, res) => {
      const successStories = await SuccessStories.find()
        .sort({ marriageDate: -1 })
        .toArray();
      res.json(successStories);
    });

    app.post("/api/success-stories", async (req, res) => {
      const { coupleImage, marriageDate, rating, successStory } = req.body;
      if (!coupleImage || !marriageDate || !rating || !successStory)
        return res.status(400).json({ error: "Missing required fields" });

      const newSuccessStory = {
        coupleImage,
        marriageDate: new Date(marriageDate),
        rating,
        successStory,
      };

      const result = await SuccessStories.insertOne(newSuccessStory);
      if (result.insertedId) {
        res.status(201).json({
          message: "Success story created successfully!",
          successStory: newSuccessStory,
          insertedId: result.insertedId,
        });
      } else {
        res.status(500).json({ error: "Failed to create success story" });
      }
    });

    app.get("/api/success-counter", async (req, res) => {
      const totalProfiles = await ProfileCollection.estimatedDocumentCount();
      const boysCount = await ProfileCollection.countDocuments({
        type: { $regex: /^male$/i },
      });
      const girlsCount = await ProfileCollection.countDocuments({
        type: { $regex: /^female$/i },
      });
      const marriagesCount = await SuccessStories.estimatedDocumentCount();
      res.json({ totalProfiles, boysCount, girlsCount, marriagesCount });
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
