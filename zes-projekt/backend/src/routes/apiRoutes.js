const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');

const authController = require('../controllers/authController');
const userController = require('../controllers/userController');
const bookingController = require('../controllers/bookingController');
const notificationController = require('../controllers/notificationController');
const requestController = require('../controllers/requestController'); // NEU

// Public
router.post('/login', authController.login);
router.post('/stamp', bookingController.stamp); // <--- NEU: Muss HIER stehen

// Protected
router.use(authMiddleware);

router.put('/password', authController.changePassword); // NEU

router.get('/users', userController.getUsers);
router.post('/users', userController.createUser); 

router.get('/dashboard', bookingController.getDashboard);
router.get('/bookings', bookingController.getBookings);
router.put('/bookings/:id', (req,res) => res.json({status:"TODO"})); // Edit Booking Placeholder
router.post('/stamp-manual', bookingController.manualStamp); // NEU
router.get('/history', bookingController.getHistory); // NEU

router.get('/notifications', notificationController.getNotifications);
router.post('/notifications/read', notificationController.markRead);

// Requests - NEU verknüpft
router.get('/requests', requestController.getRequests);
router.post('/requests', requestController.createRequest);
router.put('/requests/:id', requestController.updateRequestStatus);

module.exports = router;