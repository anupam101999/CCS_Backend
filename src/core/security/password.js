const crypto = require("crypto");

const ITERATIONS = 310000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";
const PREFIX = "pbkdf2";

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, DIGEST, (err, key) => {
      if (err) return reject(err);
      resolve(`${PREFIX}:${ITERATIONS}:${salt}:${key.toString("hex")}`);
    });
  });
}

function isHashedPassword(value = "") {
  return value.startsWith(`${PREFIX}:`);
}

function verifyPassword(password, stored) {
  if (!isHashedPassword(stored)) {
    return Promise.resolve(password === stored);
  }

  const [, iterations, salt, hash] = stored.split(":");
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      password,
      salt,
      Number(iterations),
      KEY_LENGTH,
      DIGEST,
      (err, key) => {
        if (err) return reject(err);
        const expected = Buffer.from(hash, "hex");
        const actual = Buffer.from(key.toString("hex"), "hex");
        resolve(
          expected.length === actual.length &&
            crypto.timingSafeEqual(expected, actual),
        );
      },
    );
  });
}

module.exports = { hashPassword, isHashedPassword, verifyPassword };
