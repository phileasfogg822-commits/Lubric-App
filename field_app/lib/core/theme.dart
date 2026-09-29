import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Brand blue, used for primary actions and the app bar.
const Color brandBlue = Color(0xFF0B5FA5);
const Color brandDark = Color(0xFF083E6B);
const Color moneyGreen = Color(0xFF137547);
const Color moneyRed = Color(0xFFB3261E);
const Color surfaceGrey = Color(0xFFF4F6F9);

ThemeData buildTheme() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: brandBlue,
      primary: brandBlue,
      surface: Colors.white,
    ),
  );

  return base.copyWith(
    appBarTheme: const AppBarTheme(
      backgroundColor: brandBlue,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: surfaceGrey,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
      contentPadding:
          const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Color(0xFFE3E8EF)),
      ),
    ),
  );
}

final NumberFormat _moneyFmt = NumberFormat('#,##0.00');
final NumberFormat _compactFmt = NumberFormat('#,##0');

/// The shop trades in rupees, so PKR is fixed rather than configurable on the
/// field app - the shop system is the authority on currency.
String money(num value) => 'PKR ${_moneyFmt.format(value)}';

/// Shorter form for dense lists where two decimals are noise.
String moneyShort(num value) =>
    value % 1 == 0 ? _compactFmt.format(value) : _moneyFmt.format(value);

String dateLabel(DateTime d) => DateFormat('d MMM yyyy').format(d);
String dateTimeLabel(DateTime d) => DateFormat('d MMM, h:mm a').format(d);
