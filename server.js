const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Backend Running 🚀");
});

app.post("/api/test", (req, res) => {
  res.json({ message: "API is working ✅" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server started"));
