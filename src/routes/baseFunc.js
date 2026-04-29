const router = require("express").Router();
const {
  register,
  login,
  update,
  supportTicket,
} = require("../controllers/baseFunctionalityController");

router.post("/register", register);
router.post("/login", login);
router.put("/update", update);
router.post("/support/ticket", supportTicket);

module.exports = router;
