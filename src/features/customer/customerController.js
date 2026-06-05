const authController = require("./customerAuthController");
const profileController = require("./customerProfileController");
const supportController = require("./customerSupportController");
const appointmentController = require("./customerAppointmentController");

module.exports = {
  ...authController,
  ...profileController,
  ...supportController,
  ...appointmentController,
};
