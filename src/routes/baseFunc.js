const router = require("express").Router();
const {
  register,
  login,
  update,
  supportTicket,
  getMyTickets,
} = require("../controllers/baseFunctionalityController");

router.post("/register", register);
router.post("/login", login);
router.put("/update", update);
router.post("/support/ticket", supportTicket);
router.get("/myNotifications/:userId", getMyTickets);
module.exports = router;
