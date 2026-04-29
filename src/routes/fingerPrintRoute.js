const router = require("express").Router();
const {
  fingerprintRegisterChallenge,
  fingerprintRegisterVerify,
  fingerprintChallenge,
  fingerprintVerify,
} = require("../controllers/fingerPrintController");

// fingerprint routes — NO /api/ prefix here
router.post(
  "/auth/fingerprint/register/challenge",
  fingerprintRegisterChallenge,
);
router.post("/auth/fingerprint/register/verify", fingerprintRegisterVerify);
router.post("/auth/fingerprint/challenge", fingerprintChallenge);
router.post("/auth/fingerprint/verify", fingerprintVerify);

module.exports = router;
