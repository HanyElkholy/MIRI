const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const rateLimiter = require('../middleware/rateLimiter');

const authController = require('../controllers/authController');
const userController = require('../controllers/userController');
const bookingController = require('../controllers/bookingController');
const notificationController = require('../controllers/notificationController');
const requestController = require('../controllers/requestController'); // NEU

// Public Routes (mit Rate-Limiting für Login)
router.post('/login', rateLimiter.login, authController.login);
router.post('/stamp', bookingController.stamp); // <--- NEU: Muss HIER stehen

// Protected
router.use(authMiddleware);

router.put('/password', authController.changePassword); // NEU

router.get('/users', userController.getUsers);
router.post('/users', userController.createUser);
router.delete('/users/:id', userController.deactivateUser); // NEU: User deaktivieren 

router.post('/admin/reset-password', authController.resetPasswordByAdmin);

router.get('/dashboard', bookingController.getDashboard);
router.get('/bookings', bookingController.getBookings);
router.get('/export-excel', bookingController.exportExcel);
router.get('/month-stats', bookingController.getMonthStats);
router.put('/bookings/:id', (req, res) => res.json({ status: "TODO" })); // Edit Booking Placeholder
router.post('/stamp-manual', bookingController.manualStamp); // NEU
router.get('/history', bookingController.getHistory); // NEU

router.get('/notifications', notificationController.getNotifications);
router.post('/notifications/read', notificationController.markRead);

// Requests - NEU verknüpft
router.get('/requests', requestController.getRequests);
router.post('/requests', requestController.createRequest);
router.put('/requests/:id', requestController.updateRequestStatus);
// NEU: Delete Route
router.delete('/requests/:id', requestController.deleteRequest);

module.exports = router;