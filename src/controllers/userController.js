const {
  getAllUsers,
  getUserById,
  getUserByEmail,
} = require("../models/userModel");

const listUsers = async (req, res) => {
  try {
    const users = await getAllUsers();
    return res.json({ count: users.length, users });
  } catch (err) {
    console.error("listUsers error:", err.message);
    return res.status(500).json({ message: "Failed to fetch users." });
  }
};

const getUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(Number(id))) {
      return res.status(400).json({ message: "ID must be a number." });
    }
    const user = await getUserById(id);
    if (!user) {
      return res.status(404).json({ message: `No user found with id ${id}.` });
    }
    return res.json({ user });
  } catch (err) {
    console.error("getUser error:", err.message);
    return res.status(500).json({ message: "Failed to fetch user." });
  }
};

const getUserByEmailHandler = async (req, res) => {
  try {
    const { email } = req.params;
    const user = await getUserByEmail(decodeURIComponent(email));
    if (!user) {
      return res
        .status(404)
        .json({ message: `No user found with email ${email}.` });
    }
    return res.json({ user });
  } catch (err) {
    console.error("getUserByEmail error:", err.message);
    return res.status(500).json({ message: "Failed to fetch user." });
  }
};

module.exports = { listUsers, getUser, getUserByEmailHandler };
