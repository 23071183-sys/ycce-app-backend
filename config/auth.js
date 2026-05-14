const jwt = require('jsonwebtoken');
require('dotenv').config();
const generateToken = (userId, role) => {
return jwt.sign(
{ userId, role },
process.env.JWT_SECRET,
{ expiresIn: '7d' }
);
};
const verifyToken = (token) => {
try {
return jwt.verify(token, process.env.JWT_SECRET);
} catch (err) {
return null;
}
};
module.exports = { generateToken, verifyToken };