const router = require("express").Router();
const {
  listUsers,
  getUser,
  getUserByEmailHandler,
} = require("../controllers/userController");

router.get("/", listUsers);
router.get("/email/:email", getUserByEmailHandler);
router.get("/:id", getUser);

module.exports = router;
