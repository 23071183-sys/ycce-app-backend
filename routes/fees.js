const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { adminOnly, superAdminOnly } = require('../middleware/roles');
const fees = require('../controllers/feeController');
const payments = require('../controllers/feePayments');

// The webhook is mounted separately in server.js, before express.json().
// /return is opened by the browser after paying, so it carries no token.
router.get('/return', payments.paymentReturn);

router.use(authMiddleware);

router.get('/my', fees.myInvoices);
router.get('/invoices/:id', fees.getInvoice);
router.post('/invoices/:id/pay', payments.pay);
router.post('/payments/:id/refresh', payments.refreshPayment);
router.get('/payments/:id/receipt', payments.receipt);

router.get('/structures', adminOnly, fees.listStructures);
router.post('/structures', adminOnly, fees.createStructure);
router.put('/structures/:id', adminOnly, fees.updateStructure);
router.delete('/structures/:id', adminOnly, fees.deleteStructure);
router.post('/structures/:id/publish', adminOnly, fees.publishStructure);
router.get('/structures/:id/status', adminOnly, fees.structureStatus);

router.post('/invoices/:id/offline-payment', superAdminOnly, fees.recordOfflinePayment);
router.post('/invoices/:id/waive', superAdminOnly, fees.waiveInvoice);

module.exports = router;
