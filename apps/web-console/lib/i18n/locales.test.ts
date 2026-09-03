import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOCALE,
  isLocale,
  localeFromNavigator,
  localeHtmlLang,
  parseLocale,
  resolveLocale
} from './locales.ts';

test('isLocale accepts only zh and en', () => {
  assert.equal(isLocale('zh'), true);
  assert.equal(isLocale('en'), true);
  assert.equal(isLocale('ja'), false);
  assert.equal(isLocale('zh-CN'), false);
  assert.equal(isLocale(''), false);
  assert.equal(isLocale(null), false);
  assert.equal(isLocale(undefined), false);
  assert.equal(isLocale(1), false);
});

test('parseLocale returns Locale or undefined', () => {
  assert.equal(parseLocale('zh'), 'zh');
  assert.equal(parseLocale('en'), 'en');
  assert.equal(parseLocale('zh-CN'), undefined);
  assert.equal(parseLocale('english'), undefined);
  assert.equal(parseLocale(undefined), undefined);
  assert.equal(parseLocale(null), undefined);
});

test('localeFromNavigator maps zh* to zh, empty to default, else en', () => {
  assert.equal(localeFromNavigator(undefined), DEFAULT_LOCALE);
  assert.equal(localeFromNavigator(null), DEFAULT_LOCALE);
  assert.equal(localeFromNavigator(''), DEFAULT_LOCALE);
  assert.equal(localeFromNavigator('   '), DEFAULT_LOCALE);
  assert.equal(localeFromNavigator('zh'), 'zh');
  assert.equal(localeFromNavigator('zh-CN'), 'zh');
  assert.equal(localeFromNavigator('zh-TW'), 'zh');
  assert.equal(localeFromNavigator('ZH-hans'), 'zh');
  assert.equal(localeFromNavigator('en'), 'en');
  assert.equal(localeFromNavigator('en-US'), 'en');
  assert.equal(localeFromNavigator('fr-FR'), 'en');
  assert.equal(localeFromNavigator('ja'), 'en');
});

test('resolveLocale prefers a valid stored locale', () => {
  assert.equal(resolveLocale({ stored: 'en', navigatorLanguage: 'zh-CN' }), 'en');
  assert.equal(resolveLocale({ stored: 'zh', navigatorLanguage: 'en-US' }), 'zh');
  assert.equal(resolveLocale({ stored: 'de', navigatorLanguage: 'en-US' }), 'en');
  assert.equal(resolveLocale({ stored: 'nope', navigatorLanguage: 'zh-TW' }), 'zh');
  assert.equal(resolveLocale({ stored: null, navigatorLanguage: 'en-GB' }), 'en');
  assert.equal(resolveLocale({}), DEFAULT_LOCALE);
});

test('localeHtmlLang is exhaustive', () => {
  assert.equal(localeHtmlLang('zh'), 'zh-CN');
  assert.equal(localeHtmlLang('en'), 'en');
});
