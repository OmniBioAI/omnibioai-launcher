'use strict';

class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.details = details;
  }
}

class ResolutionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ResolutionError';
    this.status = 422;
  }
}

module.exports = { ValidationError, ResolutionError };
