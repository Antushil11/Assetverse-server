const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000;

var admin = require("firebase-admin");


const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access " });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized acess" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.6si5fpl.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("asset_verse_db");

    // Collections
    const parcelsCollection = db.collection("parcels");
    const packagesCollection = db.collection("packages");
    const paymentsCollection = db.collection("payments");
    const usersCollection = db.collection("users");
    const employeeCollection = db.collection("employees");
    const assetsCollection = db.collection("assets");
    const requestsCollection = db.collection("requests");

    //middlemore with database access
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    //users related api
    app.get("/users", verifyFBToken, async (req, res) => {
      const { role, workStatus } = req.query; // ✅ Correct
      const searchText = req.query.searchText;
      const query = {};
      if (searchText) {
        query.$or = [
          { displayName: { $regex: searchText, $options: "i" } },
          { email: { $regex: searchText, $options: "i" } },
        ];
      }
      if (role) query.role = role;
      if (workStatus) query.workStatus = workStatus;

      const cursor = usersCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(5);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/users/:id", async (req, res) => {});

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await usersCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "user exists" });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const roleInfo = req.body;
        const query = { _id: new ObjectId(id) };
        const updatedDos = {
          $set: {
            role: roleInfo.role,
            workStatus: "available",
          },
        };
        const result = await usersCollection.updateOne(query, updatedDos);
        res.send(result);
      }
    );

    // new

    // Get All Parcels
    app.get("/parcels", async (req, res) => {
      const query = {};
      const { email, status } = req.query; // ✅ FIX

      if (email) query.hrEmail = email;
      if (status) query.status = status;

      const result = await parcelsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    });

    // Create parcel
    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      parcel.status = "completed"; // ✅ ADD THIS
      parcel.createdAt = new Date();

      const result = await parcelsCollection.insertOne(parcel);
      res.send(result);
    });

    app.get("/parcels/employee", async (req, res) => {
      const { employeeEmail, status } = req.query;
      const query = {};
      if (employeeEmail) {
        query.employeeEmail = employeeEmail;
      }
      if (status) {
        query.status = {$in: ['assigned', 'empplyee_arriving']};
      }

      const cursor = parcelsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.patch("/parcels/:id", async (req, res) => {
      const { parceId, userName, userEmail, userId } = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const updatedDos = {
        $set: {
          status: "assigned",
          userId: userId,
          userName: userName,
          userEmail: userEmail,
          parceId: parceId,
        },
      };
      const result = await parcelsCollection.updateOne(query, updatedDos);

      //update user information
      const userQuery = { _id: new ObjectId(userId) };
      const userUpdateDoc = {
        $set: {
          workStatus: "in_delivery",
        },
      };
      const userResult = await usersCollection.updateOne(
        userQuery,
        userUpdateDoc
      );
      res.send(userResult);
    });


    // Route to get assigned assets for printing/PDF
    app.get("/parcels/employee/print", verifyFBToken, async (req, res) => {
      const email = req.query.email;

      if (!email || email !== req.decoded_email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { userEmail: email, status: "assigned" }; // only assigned assets

      const assets = await parcelsCollection
        .find(query)
        .sort({ approvalDate: -1 })
        .toArray();

      // Send JSON to frontend, frontend can convert to PDF
      res.send(assets);
    });



    

    app.patch("/parcels/:id/status", async (req, res) => {
      const { status } = req.body;
      const query = { _id: new ObjectId(req.params.id) };
      const updatedDos = {
        $set: {
          status: status,
        },
      };
      const result = await parcelsCollection.updateOne(query, updatedDos);
      res.send(result);
    });

    // Delete parcel
    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const result = await parcelsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // Get All Packages
    app.get("/packages", async (req, res) => {
      const result = await packagesCollection.find().toArray();
      res.send(result);
    });

    app.post("/create-checkout-session", async (req, res) => {
      const { hrEmail, packageName, price, employeeLimit } = req.body;

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: price * 100,
                product_data: {
                  name: packageName,
                },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          customer_email: hrEmail,

          metadata: {
            packageName,
            employeeLimit,
          },

          success_url: `${process.env.SITE_DOMAIN}/HR-Manager/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/HR-Manager/payment-cancel`,
        });
        console.log(session);

        res.send({ url: session.url });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // new code

    // PATCH route for 
    


    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        if (!sessionId)
          return res.status(400).send({ error: "Missing session_id" });

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (!session || session.payment_status !== "paid")
          return res.status(400).send({ error: "Payment not completed" });

        const transactionId = session.payment_intent;

        const existingPayment = await paymentsCollection.findOne({
          transactionId,
        });
        if (existingPayment)
          return res.send({
            message: "Payment already exists",
            payment: existingPayment,
          });

        const paymentData = {
          hrEmail: session.customer_email,
          packageName: session.metadata.packageName,
          employeeLimit: Number(session.metadata.employeeLimit),
          amount: session.amount_total / 100,
          transactionId,
          paymentDate: new Date(),
          status: "completed",
        };

        await paymentsCollection.insertOne(paymentData);

        await usersCollection.updateOne(
          { email: session.customer_email },
          {
            $set: {
              subscription: session.metadata.packageName,
              employeeLimit: Number(session.metadata.employeeLimit),
            },
          }
        );

        res.send({ success: true, payment: paymentData });
      } catch (error) {
        console.error("Payment-save error:", error);
        res.status(500).send({ error: error.message });
      }
    });

    // Get payment history
    app.get("/payments", verifyFBToken, async (req, res) => {
      const { email } = req.query;
      const query = email ? { hrEmail: email } : {};

      if (email !== req.decoded_email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const result = await paymentsCollection
        .find(query)
        .sort({ paymentDate: -1 })
        .toArray();
      res.send(result);
    });

    //employees related 
    app.get("/employee", async (req, res) => {
      const query = {};

      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = employeeCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.patch("/employee/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedDos = {
        $set: {
          status: status,
          workStatus: "available",
        },
      };

      const result = await employeeCollection.updateOne(query, updatedDos);

      if (status === "approved") {
        const email = req.body.email;
        const userQuery = { email };
        const updateUser = {
          $set: {
            role: "employee",
          },
        };
        const userResult = await usersCollection.updateOne(
          userQuery,
          updateUser
        );
      }
      res.send(result);
    });

    // Delete parcels
    app.delete("/employee/:id", async (req, res) => {
      const id = req.params.id;
      const result = await employeeCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    //employee api
    app.post("/employee", async (req, res) => {
      const employee = req.body;
      employee.status = "pending";
      employee.createdAt = new Date();

      const result = await employeeCollection.insertOne(employee);
      res.send(result);
    });

    // assets

    app.get("/assets", verifyFBToken, async (req, res) => {
      const result = await assetsCollection
        .find({ availableQuantity: { $gt: 0 } })
        .toArray();

      res.send(result);
    });

    app.post("/requests", verifyFBToken, async (req, res) => {
      const request = req.body;

      request.requestStatus = "pending";
      request.requestDate = new Date();
      request.approvalDate = null;
      request.processedBy = null;

      const result = await requestsCollection.insertOne(request);
      res.send(result);
    });

    app.get("/assets", verifyFBToken, async (req, res) => {
      const query = {
        availableQuantity: { $gt: 0 },
      };

      const result = await assetsCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/requests", verifyFBToken, async (req, res) => {
      const request = req.body;

      request.requestStatus = "pending";
      request.requestDate = new Date();

      const result = await requestsCollection.insertOne(request);
      res.send(result);
    });

    // await client.db("admin").command({ ping: 1 });
    // console.log("MongoDB connected successfully!");
  } finally {
    // Do not close client for server apps
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("AssetVerse Backend Running!");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
