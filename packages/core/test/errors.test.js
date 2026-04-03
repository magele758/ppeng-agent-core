import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError,
  NotFoundError,
  ValidationError,
  PayloadTooLargeError,
  ConflictError,
  AuthorizationError,
  TimeoutError,
  errorMessage,
  httpStatusFromError,
} from '../dist/errors.js';

test('AppError sets code, message, statusCode', () => {
  const err = new AppError('CUSTOM', 'boom', 502);
  assert.equal(err.code, 'CUSTOM');
  assert.equal(err.message, 'boom');
  assert.equal(err.statusCode, 502);
  assert.ok(err instanceof Error);
});

test('NotFoundError defaults to 404', () => {
  const err = new NotFoundError('session', 'abc');
  assert.equal(err.statusCode, 404);
  assert.equal(err.code, 'NOT_FOUND');
  assert.ok(err.message.includes('session'));
  assert.ok(err.message.includes('abc'));
});

test('NotFoundError without id', () => {
  const err = new NotFoundError('agent');
  assert.equal(err.message, 'agent not found');
});

test('ValidationError defaults to 400', () => {
  const err = new ValidationError('bad input');
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, 'VALIDATION_ERROR');
});

test('PayloadTooLargeError defaults to 413', () => {
  const err = new PayloadTooLargeError(1024);
  assert.equal(err.statusCode, 413);
  assert.ok(err.message.includes('1024'));
});

test('ConflictError defaults to 409', () => {
  const err = new ConflictError('already running');
  assert.equal(err.statusCode, 409);
});

test('AuthorizationError defaults to 403', () => {
  const err = new AuthorizationError();
  assert.equal(err.statusCode, 403);
  assert.equal(err.message, 'Forbidden');
});

test('AuthorizationError accepts custom message', () => {
  const err = new AuthorizationError('Token expired');
  assert.equal(err.message, 'Token expired');
});

test('errorMessage extracts Error.message', () => {
  assert.equal(errorMessage(new Error('oops')), 'oops');
});

test('errorMessage stringifies non-Error values', () => {
  assert.equal(errorMessage('string val'), 'string val');
  assert.equal(errorMessage(42), '42');
  assert.equal(errorMessage(null), 'null');
});

test('httpStatusFromError returns statusCode for AppError', () => {
  assert.equal(httpStatusFromError(new NotFoundError('x')), 404);
  assert.equal(httpStatusFromError(new ValidationError('x')), 400);
  assert.equal(httpStatusFromError(new PayloadTooLargeError(1)), 413);
});

test('httpStatusFromError returns 400 for JSON SyntaxError', () => {
  const err = new SyntaxError('Unexpected token in JSON');
  assert.equal(httpStatusFromError(err), 400);
});

test('httpStatusFromError returns 500 for generic Error', () => {
  assert.equal(httpStatusFromError(new Error('generic')), 500);
  assert.equal(httpStatusFromError('string'), 500);
});

test('AppError subclasses are instanceof Error', () => {
  const errors = [
    new NotFoundError('a'),
    new ValidationError('b'),
    new PayloadTooLargeError(1),
    new ConflictError('c'),
    new AuthorizationError(),
    new TimeoutError(),
  ];
  for (const e of errors) {
    assert.ok(e instanceof Error);
    assert.ok(e instanceof AppError);
  }
});

test('TimeoutError defaults to 504', () => {
  const err = new TimeoutError();
  assert.equal(err.statusCode, 504);
  assert.equal(err.code, 'TIMEOUT');
  assert.equal(err.message, 'Request timed out');
});

test('TimeoutError accepts custom message', () => {
  const err = new TimeoutError('Operation X timed out after 30s');
  assert.equal(err.message, 'Operation X timed out after 30s');
  assert.equal(err.statusCode, 504);
});

test('AppError with default statusCode is 500', () => {
  const err = new AppError('INTERNAL', 'something broke');
  assert.equal(err.statusCode, 500);
});

test('httpStatusFromError returns 500 for non-JSON SyntaxError', () => {
  assert.equal(httpStatusFromError(new SyntaxError('Unexpected token')), 500);
});
