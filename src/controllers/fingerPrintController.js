const pool = require("../config/db");
const {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} = require("@simplewebauthn/server");

const RP_NAME = process.env.WEBAUTHN_RP_NAME || "Calcutta Canvas Space";
const DEFAULT_RP_ID = "calcutta-canvas-space.vercel.app";
const DEFAULT_ORIGIN = "https://calcutta-canvas-space.vercel.app";

const getWebAuthnConfig = (req) => {
  const requestOrigin = req.get("origin");
  const configuredOrigin = process.env.WEBAUTHN_ORIGIN;
  const expectedOrigin = configuredOrigin || requestOrigin || DEFAULT_ORIGIN;

  let originHost = DEFAULT_RP_ID;
  try {
    originHost = new URL(expectedOrigin).hostname;
  } catch (_err) {
    originHost = DEFAULT_RP_ID;
  }

  const isLocalOrigin =
    originHost === "localhost" ||
    originHost === "127.0.0.1" ||
    originHost === "::1";

  return {
    rpID:
      process.env.WEBAUTHN_RP_ID ||
      (isLocalOrigin ? "localhost" : DEFAULT_RP_ID),
    origin: expectedOrigin,
  };
};

// ── REGISTER CHALLENGE ────────────────────────────────────────────
const fingerprintRegisterChallenge = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: "userId required." });
    const { rpID, origin } = getWebAuthnConfig(req);

    const { rows } = await pool.query(
      `SELECT id, full_name, email, passkeys FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ message: "User not found." });

    // Only keep real passkeys, strip any stale pending challenges
    const passkeys = (user.passkeys || []).filter((pk) => pk.credentialID);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userID: new TextEncoder().encode(String(user.id)), // ← fix: Uint8Array instead of string
      userName: user.email,
      userDisplayName: user.full_name,
      attestationType: "none",
      excludeCredentials: passkeys.map((pk) => ({
        id: pk.credentialID,
        type: "public-key",
      })),
      authenticatorSelection: {
        userVerification: "required",
        residentKey: "preferred",
      },
    });

    // Save real passkeys + one pending challenge entry
    await pool.query(`UPDATE users SET passkeys = $1::jsonb WHERE id = $2`, [
      JSON.stringify([
        ...passkeys,
        {
          pendingChallenge: options.challenge,
          pendingOrigin: origin,
          pendingRPID: rpID,
        },
      ]),
      userId,
    ]);

    console.log(`🔑 Register challenge for user: ${userId}`);
    return res.json(options);
  } catch (err) {
    console.error("fingerprintRegisterChallenge error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ── REGISTER VERIFY ───────────────────────────────────────────────
const fingerprintRegisterVerify = async (req, res) => {
  try {
    const { userId, credential } = req.body;
    if (!userId || !credential)
      return res
        .status(400)
        .json({ message: "userId and credential required." });

    const { rows } = await pool.query(
      `SELECT id, passkeys FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ message: "User not found." });

    const passkeys = user.passkeys || [];
    const pendingEntry = passkeys.find((pk) => pk.pendingChallenge);
    if (!pendingEntry)
      return res.status(400).json({ message: "No pending challenge found." });
    const { rpID, origin } = getWebAuthnConfig(req);

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: pendingEntry.pendingChallenge,
      expectedOrigin: pendingEntry.pendingOrigin || origin,
      expectedRPID: pendingEntry.pendingRPID || rpID,
      requireUserVerification: true,
    });

    if (!verification.verified)
      return res
        .status(401)
        .json({ message: "Fingerprint registration failed." });

    const { registrationInfo } = verification;

    // Remove pending challenge, add new passkey
    const updatedPasskeys = [
      ...passkeys.filter((pk) => !pk.pendingChallenge),
      {
        credentialID: Buffer.from(registrationInfo.credentialID).toString(
          "base64url",
        ),
        credentialPublicKey: Buffer.from(
          registrationInfo.credentialPublicKey,
        ).toString("base64url"),
        counter: registrationInfo.counter,
      },
    ];

    await pool.query(`UPDATE users SET passkeys = $1::jsonb WHERE id = $2`, [
      JSON.stringify(updatedPasskeys),
      userId,
    ]);

    console.log(`✅ Fingerprint registered for user: ${userId}`);
    return res.json({
      success: true,
      message: "Fingerprint registered successfully.",
    });
  } catch (err) {
    console.error("fingerprintRegisterVerify error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ── LOGIN CHALLENGE ───────────────────────────────────────────────
const fingerprintChallenge = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: "userId required." });
    const { rpID, origin } = getWebAuthnConfig(req);

    const { rows } = await pool.query(
      `SELECT id, passkeys FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ message: "User not found." });

    // Only real passkeys, strip stale pending challenges
    const passkeys = (user.passkeys || []).filter((pk) => pk.credentialID);

    if (passkeys.length === 0) {
      return res.status(409).json({
        code: "FINGERPRINT_NOT_REGISTERED",
        message: "No fingerprint registered. Please login with password first.",
      });
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: passkeys.map((pk) => ({
        id: pk.credentialID,
        type: "public-key",
      })),
      userVerification: "required",
    });

    // Save real passkeys + pending challenge
    await pool.query(`UPDATE users SET passkeys = $1::jsonb WHERE id = $2`, [
      JSON.stringify([
        ...passkeys,
        {
          pendingChallenge: options.challenge,
          pendingOrigin: origin,
          pendingRPID: rpID,
        },
      ]),
      userId,
    ]);

    console.log(`🔑 Login challenge for user: ${userId}`);
    return res.json(options);
  } catch (err) {
    console.error("fingerprintChallenge error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ── LOGIN VERIFY ──────────────────────────────────────────────────
const fingerprintVerify = async (req, res) => {
  try {
    const { userId, credential } = req.body;
    if (!userId || !credential)
      return res
        .status(400)
        .json({ message: "userId and credential required." });

    const { rows } = await pool.query(
      `SELECT id, full_name, email, phone, dob, address, passkeys FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ message: "User not found." });

    const passkeys = user.passkeys || [];
    const pendingEntry = passkeys.find((pk) => pk.pendingChallenge);
    if (!pendingEntry)
      return res
        .status(400)
        .json({ message: "No pending challenge. Request a new one." });
    const { rpID, origin } = getWebAuthnConfig(req);

    const matchedKey = passkeys.find((pk) => pk.credentialID === credential.id);
    if (!matchedKey)
      return res.status(401).json({ message: "Fingerprint not recognised." });

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: pendingEntry.pendingChallenge,
      expectedOrigin: pendingEntry.pendingOrigin || origin,
      expectedRPID: pendingEntry.pendingRPID || rpID,
      requireUserVerification: true,
      authenticator: {
        credentialID: Buffer.from(matchedKey.credentialID, "base64url"),
        credentialPublicKey: Buffer.from(
          matchedKey.credentialPublicKey,
          "base64url",
        ),
        counter: matchedKey.counter,
      },
    });

    if (!verification.verified)
      return res
        .status(401)
        .json({ message: "Fingerprint verification failed." });

    // Remove pending challenge, update counter
    const updatedPasskeys = passkeys
      .filter((pk) => !pk.pendingChallenge)
      .map((pk) =>
        pk.credentialID === credential.id
          ? { ...pk, counter: verification.authenticationInfo.newCounter }
          : pk,
      );

    await pool.query(`UPDATE users SET passkeys = $1::jsonb WHERE id = $2`, [
      JSON.stringify(updatedPasskeys),
      userId,
    ]);

    console.log(`✅ Fingerprint login: ${user.email}`);
    return res.json({
      token: `token-${user.id}-${Date.now()}`,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone || "",
        dob: user.dob
          ? user.dob instanceof Date
            ? user.dob.toISOString().split("T")[0]
            : user.dob
          : "",
        address: user.address || "",
      },
    });
  } catch (err) {
    console.error("fingerprintVerify error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  fingerprintRegisterChallenge,
  fingerprintRegisterVerify,
  fingerprintChallenge,
  fingerprintVerify,
};
