import 'dart:math';

final _random = Random.secure();

/// RFC 4122 version 4 UUID.
///
/// This is the sync key for every money row: the client generates it, the
/// server de-duplicates on it. That is what makes pushing the same movement
/// twice (after a dropped connection, a retry, or a double tap) harmless
/// instead of double-counting cash.
String newUuid() {
  final b = List<int>.generate(16, (_) => _random.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 1
  final hex = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
