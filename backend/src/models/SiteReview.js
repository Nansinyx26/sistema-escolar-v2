const mongoose = require('mongoose');

const SiteReviewSchema = new mongoose.Schema({
    userId: { type: String, ref: 'Usuario', required: true, unique: true },
    userName: { type: String, required: true },
    userType: { type: String, enum: ['responsavel', 'professor', 'diretor', 'admin'], required: true },
    userAvatar: { type: String, default: '' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, maxlength: 500 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SiteReview', SiteReviewSchema, 'siteReviews');
