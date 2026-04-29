const pool = require("../config/db");

const toPublic = (row) => ({
  id: row.id,
  fullName: row.full_name ?? row.fullName ?? "",
  email: row.email ?? "",
  phone: row.phone ?? "",
  dob: row.dob
    ? row.dob instanceof Date
      ? row.dob.toISOString().split("T")[0]
      : row.dob
    : "",
  address: row.address ?? "",
});

const getAllUsers = async () => {
  const { rows } = await pool.query(
    `SELECT id, full_name, email, phone, dob, address FROM users ORDER BY id`,
  );
  return rows.map(toPublic);
};

const getUserById = async (id) => {
  const { rows } = await pool.query(
    `SELECT id, full_name, email, phone, dob, address
     FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ? toPublic(rows[0]) : null;
};

const getUserByEmail = async (email) => {
  const { rows } = await pool.query(
    `SELECT id, full_name, email, phone, dob, address
     FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email.trim()],
  );
  return rows[0] ? toPublic(rows[0]) : null;
};

module.exports = { getAllUsers, getUserById, getUserByEmail };
