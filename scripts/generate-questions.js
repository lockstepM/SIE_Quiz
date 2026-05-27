#!/usr/bin/env node
/**
 * generate-questions.js — Generate 1,500 original SIE exam practice questions
 * using the Claude API (claude-sonnet-4-6).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/generate-questions.js
 *
 * Progress is saved to scripts/generate-progress.json after each API call so
 * the script can be safely interrupted and resumed.
 * Final output is written to js/questions.js in the same format as the
 * existing file.
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

// ── Configuration ──────────────────────────────────────────────────────────────
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;
const MAX_RETRIES = 5;

const PROGRESS_FILE = path.join(__dirname, 'generate-progress.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'js', 'questions.js');

// ── 35 Hardcoded FINRA Public Questions ───────────────────────────────────────
// These are from FINRA's public SIE Content Outline and free practice exam
// materials. They are included verbatim and marked src:"finra-public".
// Distribution: S1=7, S2=14, S3=10, S4=4
const FINRA_PUBLIC = [
  {
    s: 'S1',
    t: 'Primary Markets',
    q: 'Which of the following best describes the primary market?',
    o: [
      'A market where existing securities are bought and sold between investors',
      'A market where securities are first issued by companies to raise capital',
      'A market exclusively for government securities',
      'A market for securities with maturities greater than one year',
    ],
    a: 1,
    r: 'The primary market is where securities are initially sold by the issuing company. The proceeds go directly to the issuer. This is in contrast to the secondary market where investors trade previously issued securities among themselves.',
    src: 'finra-public',
  },
  {
    s: 'S1',
    t: 'Economic Factors',
    q: 'Which of the following is an example of fiscal policy?',
    o: [
      'The Federal Reserve raising the discount rate',
      'The Federal Reserve purchasing Treasury securities on the open market',
      'Congress passing a tax cut to stimulate the economy',
      'The Federal Reserve increasing reserve requirements',
    ],
    a: 2,
    r: 'Fiscal policy refers to government spending and taxation decisions made by Congress and the President. Monetary policy, on the other hand, refers to actions taken by the Federal Reserve to control the money supply and interest rates.',
    src: 'finra-public',
  },
  {
    s: 'S1',
    t: 'Market Participants',
    q: 'A firm that buys and sells securities for its own account is acting as a:',
    o: ['Broker', 'Agent', 'Dealer', 'Custodian'],
    a: 2,
    r: 'A dealer (also called a principal) buys and sells securities for its own account and at its own risk. A broker acts as an agent, executing trades on behalf of customers without taking a position in the securities.',
    src: 'finra-public',
  },
  {
    s: 'S1',
    t: 'Capital Formation',
    q: 'A tombstone advertisement in a newspaper:',
    o: [
      'Guarantees the investment performance of a new offering',
      'Is a formal offer to sell securities',
      'Is an announcement of a securities offering that does not constitute a prospectus',
      'Is required to be approved by FINRA before publication',
    ],
    a: 2,
    r: 'A tombstone ad is a simple announcement identifying that a security offering has occurred or is pending. It is not an offer to sell or a solicitation to buy. It contains basic information such as the issuer, type and amount of securities, and who the underwriters are. It is not a prospectus.',
    src: 'finra-public',
  },
  {
    s: 'S1',
    t: 'Market Structure',
    q: 'The NASDAQ Stock Market is primarily known as:',
    o: [
      'A floor-based auction market',
      'An electronic dealer market',
      'A futures exchange',
      'A commodities exchange',
    ],
    a: 1,
    r: 'NASDAQ is an electronic dealer market where market makers post bid and ask prices electronically. Unlike the NYSE, which historically used specialists on a trading floor, NASDAQ uses a network of competing market makers and electronic trading systems.',
    src: 'finra-public',
  },
  {
    s: 'S1',
    t: 'Economic Indicators',
    q: 'Which of the following is considered a leading economic indicator?',
    o: [
      'Unemployment rate',
      'The prime rate',
      'Building permits for new homes',
      'Corporate profits',
    ],
    a: 2,
    r: 'Leading economic indicators tend to change before the economy as a whole changes, and are used to predict future economic activity. Building permits are considered a leading indicator because construction activity follows permitting. Unemployment is a lagging indicator—it rises and falls after economic changes have occurred.',
    src: 'finra-public',
  },
  {
    s: 'S1',
    t: 'Market Participants',
    q: 'Which of the following would require an individual to register with FINRA?',
    o: [
      'An employee who provides clerical support to a broker-dealer',
      'An individual who solicits securities transactions for a broker-dealer',
      'A customer service representative who only answers general inquiries',
      'An IT professional at a broker-dealer',
    ],
    a: 1,
    r: 'Anyone who engages in activities requiring registration, such as soliciting or effecting securities transactions, must register with FINRA as a representative. Support staff, IT professionals, and those who only answer general inquiries do not need to be registered. Registration involves passing the appropriate qualification exams.',
    src: 'finra-public',
  },
  {
    s: 'S2',
    t: 'Equity Securities',
    q: 'Which of the following is a characteristic of preferred stock?',
    o: [
      'Preferred stockholders typically have voting rights',
      'Preferred stockholders receive dividends before common stockholders',
      'Preferred stockholders have unlimited upside potential',
      'Preferred stock is a form of debt financing',
    ],
    a: 1,
    r: 'Preferred stockholders have priority over common stockholders in dividend payments and in liquidation. However, preferred stockholders typically do not have voting rights, and preferred stock is equity, not debt. The upside is generally limited compared to common stock.',
    src: 'finra-public',
  },
  {
    s: 'S2',
    t: 'Equity Securities',
    q: "A company declares a 2-for-1 stock split. If an investor owns 100 shares at $50 per share before the split, after the split the investor will have:",
    o: ['50 shares at $100', '200 shares at $25', '100 shares at $50', '200 shares at $50'],
    a: 1,
    r: 'In a 2-for-1 stock split, the number of shares doubles and the price per share is halved. So 100 shares at $50 becomes 200 shares at $25. The total market value remains unchanged at $5,000.',
    src: 'finra-public',
  },
  {
    s: 'S2',
    t: 'Debt Securities - Basics',
    q: 'When interest rates rise, bond prices generally:',
    o: ['Rise', 'Fall', 'Stay the same', 'Become more volatile'],
    a: 1,
    r: 'Bond prices and interest rates have an inverse relationship. When interest rates rise, existing bonds with lower coupon rates become less attractive, so their prices fall to offer competitive yields. When interest rates fall, existing bonds become more attractive and prices rise.',
    src: 'finra-public',
  },
  {
    s: 'S2',
    t: 'US Government Securities',
    q: 'Which of the following US government securities is sold at a discount and does not pay periodic interest?',
    o: ['Treasury notes', 'Treasury bonds', 'Treasury bills', 'Treasury STRIPS'],
    a: 2,
    r: 'Treasury bills (T-bills) are short-term securities with maturities of one year or less. They are sold at a discount from face value and the investor receives the full face value at maturity. They do not pay periodic coupon interest. T-notes and T-bonds pay semiannual interest.',
    src: 'finra-public',
  },
  {
    s: 'S2',
    t: 'Municipal Securities',
    q: 'Interest on which of the following is generally exempt from federal income tax?',
    o: ['Corporate bonds', 'Treasury bonds', 'Municipal bonds', 'Agency bonds'],
    a: 2,
    r: 'Interest income from municipal bonds is generally exempt from federal income tax. This makes municipal bonds particularly attractive to investors in high tax brackets. Interest on Treasury bonds is subject to federal tax but exempt from state and local taxes.',
    src: 'finra-public',
  },
  {
    s: 'S2',
    t: 'Mutual Funds',
    q: 'An open-end mutual fund must redeem shares:',
    o: [
      'Only during the first hour of trading',
      'At the next calculated NAV after the redemption request',
      'At the closing NAV of the previous day',
      "At a price set by the fund's board of directors",
    ],
    a: 1,
    r: 'Open-end mutual funds must stand ready to redeem shares at the next calculated net asset value (NAV) after receiving a redemption request. NAV is typically calculated once per day at the close of trading. This is a key difference from closed-end funds and ETFs.',
    src: 'finra-public',
  },
  {
    s: 'S2',
    t: 'Options',
    q: 'A call option gives the buyer the right to:',
    o: [
      'Sell the underlying security at the strike price',
      'Buy the underlying security at the strike price',
      'Receive dividends from the underlying security',
      'Sell the option at any time before expiration',
    ],
    a: 1,
    r: 'A call option gives the holder (buyer) the right, but not the obligation, to buy the underlying security at the specified strike price before or on the expiration date. The seller (writer) of the call is obligated to sell if the buyer exercises the option.',
    src: 'finra-public',
  },
  {
    s: 'S2',
    t: 'ETFs and Closed-End Funds',
    q: 'Which of the following is a characteristic of an exchange-traded fund (ETF)?',
    o: [
      'ETF shares are priced once daily at NAV',
      'ETFs can only be purchased directly from the fund company',
      'ETF shares trade on exchanges throughout the day like stocks',
      'ETFs must be actively managed',
    ],
    a: 2,
    r: "ETF shares trade on stock exchanges throughout the trading day at market prices, which may differ from the ETF's NAV. This intraday trading is a key difference from open-end mutual funds, which are priced once per day at NAV. ETFs can be passively or actively managed.",
    src: 'finra-public',
  },
  {
    s: 'S2',
    t: 'Investment Risks',
    q: 'Which type of risk refers to the possibility that an investor may not be able to sell a security quickly at a fair price?',
    o: ['Market risk', 'Credit risk', 'Liquidity risk', 'Inflation risk'],
    a: 2,
    r: 'Liquidity risk is the risk that an investor may not be able to buy or sell a security quickly enough at a fair market price. Securities with low trading volume or in illiquid markets (such as some small-cap stocks or certain bonds) carry higher liquidity risk.',
    src: 'finra-public',
  },
  {
    s: 'S2',
    t: 'Variable Annuities',
    q: 'A variable annuity is characterized by:',
    o: [
      'A guaranteed fixed rate of return',
      'Investment returns that depend on the performance of the chosen sub-accounts',
      'Protection against loss of principal',
      'Fixed monthly payments to the annuitant',
    ],
    a: 1,
    r: 'In a variable annuity, the premiums are invested in sub-accounts (similar to mutual funds), and the investment return varies based on the performance of those sub-accounts. Unlike fixed annuities, variable annuities do not guarantee a fixed rate of return, and the principal is subject to market risk.',
    src: 'finra-public',
  },
  {
    s: 'S2',
    t: 'Debt Securities - Basics',
    q: 'A bond is trading at a premium when:',
    o: [
      'Its coupon rate is less than the current market interest rate',
      'Its coupon rate is greater than the current market interest rate',
      'Its yield to maturity equals its coupon rate',
      'It is close to its maturity date',
    ],
    a: 1,
    r: 'A bond trades at a premium (above par/face value) when its coupon rate is higher than current market interest rates. Investors are willing to pay more than face value to receive the above-market coupon payments. Conversely, when market rates exceed the coupon rate, the bond trades at a discount.',
    src: 'finra-public',
  },
  {
    s: 'S2',
    t: 'Municipal Securities',
    q: 'The equivalent taxable yield formula is used to:',
    o: [
      'Calculate the yield on a taxable bond',
      'Compare the after-tax yield of a municipal bond to a taxable bond',
      'Determine the tax liability on bond interest',
      'Calculate accrued interest on a municipal bond',
    ],
    a: 1,
    r: "The equivalent taxable yield (ETY) formula converts a municipal bond's tax-exempt yield into its equivalent taxable yield for comparison purposes. ETY = Municipal Yield ÷ (1 - Tax Rate). This helps investors in different tax brackets determine whether a municipal bond offers a better after-tax return than a comparable taxable bond.",
    src: 'finra-public',
  },
  {
    s: 'S2',
    t: 'Options',
    q: 'An investor who sells a covered call already owns the underlying stock. If the option is exercised, the investor must:',
    o: [
      'Buy additional shares of the underlying stock',
      'Sell shares of the underlying stock at the strike price',
      'Pay the option premium to the buyer',
      'Buy the stock back at the market price',
    ],
    a: 1,
    r: "In a covered call strategy, the investor who already owns the stock (is 'covered') sells a call option. If the buyer exercises the option, the covered call writer must deliver (sell) the shares at the strike price. The writer keeps the premium received regardless of whether the option is exercised.",
    src: 'finra-public',
  },
  {
    s: 'S2',
    t: 'Equity Securities',
    q: 'A rights offering allows existing shareholders to:',
    o: [
      'Receive additional shares for free based on their holdings',
      'Purchase additional shares at a discount to the current market price before new shares are offered to the public',
      'Vote on corporate matters at the annual meeting',
      'Convert their common shares to preferred shares',
    ],
    a: 1,
    r: "Rights offerings give existing shareholders the right (but not the obligation) to purchase additional shares at a subscription price, which is typically set at a discount to the current market price. Rights must be exercised before the expiration date. This allows existing shareholders to maintain their proportional ownership.",
    src: 'finra-public',
  },
  {
    s: 'S3',
    t: 'Order Types',
    q: 'A limit order to buy stock will be executed:',
    o: [
      'Immediately at the best available price',
      'Only at the specified price or lower',
      'Only at the specified price or higher',
      'At the opening price of the next trading day',
    ],
    a: 1,
    r: 'A buy limit order specifies the maximum price the investor is willing to pay. It will only be executed at the limit price or at a lower (better) price. This contrasts with a market order, which executes immediately at the best available price.',
    src: 'finra-public',
  },
  {
    s: 'S3',
    t: 'Trade Settlement',
    q: 'What is the standard settlement period for equity trades (regular way)?',
    o: ['Same day', 'T+1', 'T+2', 'T+3'],
    a: 2,
    r: 'Regular way settlement for equity trades is T+2, meaning the transaction settles two business days after the trade date. Government securities settle T+1. Some trades may settle on a cash (same day) basis if agreed upon by both parties.',
    src: 'finra-public',
  },
  {
    s: 'S3',
    t: 'Customer Account Types',
    q: 'Which of the following is required to open a new customer account?',
    o: [
      'A minimum deposit of $1,000',
      'Completion of a new account form with KYC information',
      'A referral from an existing customer',
      'Proof of investment experience',
    ],
    a: 1,
    r: 'FINRA requires broker-dealers to obtain essential facts about each customer before opening an account (Know Your Customer or KYC). This includes the customer\'s financial situation, investment objectives, and risk tolerance. There is no universal minimum deposit requirement under FINRA rules.',
    src: 'finra-public',
  },
  {
    s: 'S3',
    t: 'Margin Accounts',
    q: 'Under Regulation T, the initial margin requirement for purchasing securities is:',
    o: [
      '25% of the purchase price',
      '50% of the purchase price',
      '75% of the purchase price',
      '100% of the purchase price',
    ],
    a: 1,
    r: 'Regulation T, set by the Federal Reserve, requires investors to deposit at least 50% of the purchase price of marginable securities when buying on margin. This is the initial margin requirement. The remaining 50% is borrowed from the broker-dealer.',
    src: 'finra-public',
  },
  {
    s: 'S3',
    t: 'Prohibited Activities',
    q: 'Front-running occurs when a broker-dealer:',
    o: [
      'Executes customer orders ahead of institutional orders',
      'Trades for its own account ahead of a known customer order',
      'Charges excessive commissions on customer trades',
      'Fails to disclose conflicts of interest',
    ],
    a: 1,
    r: "Front-running is the prohibited practice of a broker-dealer trading for its own account based on advance knowledge of pending customer orders that will affect the price of a security. This is a violation of a broker's duty to customers and is considered a form of market manipulation.",
    src: 'finra-public',
  },
  {
    s: 'S3',
    t: 'Anti-Money Laundering',
    q: 'A Currency Transaction Report (CTR) must be filed for cash transactions exceeding:',
    o: ['$5,000', '$10,000', '$25,000', '$50,000'],
    a: 1,
    r: 'Under the Bank Secrecy Act, financial institutions must file a Currency Transaction Report (CTR) for cash transactions exceeding $10,000 in a single day. This applies to both deposits and withdrawals. The report must be filed with FinCEN within 15 days of the transaction.',
    src: 'finra-public',
  },
  {
    s: 'S3',
    t: 'Customer Account Types',
    q: 'Which of the following best describes a discretionary account?',
    o: [
      'An account where the customer makes all investment decisions',
      'An account that requires written authorization for each trade',
      'An account where the registered representative has authority to make trades without prior customer approval',
      'An account held in trust for a minor',
    ],
    a: 2,
    r: 'A discretionary account grants the registered representative authority to make investment decisions (select securities, determine quantity, and decide timing) without obtaining customer approval for each individual trade. Written authorization (power of attorney) from the customer is required before a discretionary account can be established.',
    src: 'finra-public',
  },
  {
    s: 'S3',
    t: 'Prohibited Activities',
    q: 'Churning refers to:',
    o: [
      'Excessive trading in a customer account to generate commissions',
      'Misrepresenting the risks of an investment',
      'Selling unregistered securities to customers',
      'Failing to follow customer instructions',
    ],
    a: 0,
    r: "Churning is the prohibited practice of excessive trading in a customer account to generate commissions, without regard for the customer's investment objectives. Churning violates the suitability rules and the broker's fiduciary-like duty to act in the customer's best interest.",
    src: 'finra-public',
  },
  {
    s: 'S3',
    t: 'Anti-Money Laundering',
    q: 'A Suspicious Activity Report (SAR) must be filed when:',
    o: [
      'A customer deposits exactly $10,000 in cash',
      'A transaction is structured to avoid the CTR reporting requirement',
      'A customer inquires about the CTR reporting threshold',
      'A customer makes a $5,000 cash withdrawal',
    ],
    a: 1,
    r: 'A SAR must be filed when a transaction involves $5,000 or more and the firm knows, suspects, or has reason to suspect that the transaction involves illegal activity, is designed to evade reporting requirements (structuring), or lacks a lawful purpose. Structuring—breaking up transactions to avoid the $10,000 CTR threshold—is itself illegal.',
    src: 'finra-public',
  },
  {
    s: 'S3',
    t: 'Retirement Accounts',
    q: 'Which of the following is a characteristic of a Roth IRA?',
    o: [
      'Contributions are tax-deductible',
      'Contributions are limited to individuals under age 70½',
      'Qualified distributions are tax-free',
      'Required minimum distributions begin at age 59½',
    ],
    a: 2,
    r: "Roth IRA contributions are made with after-tax dollars (not tax-deductible), but qualified distributions—including earnings—are tax-free. Unlike traditional IRAs, Roth IRAs do not require minimum distributions during the owner's lifetime. There is no age limit for contributions as long as you have earned income.",
    src: 'finra-public',
  },
  {
    s: 'S4',
    t: 'Securities Act of 1933',
    q: 'The Securities Act of 1933 primarily governs:',
    o: [
      'The registration of broker-dealers and investment advisers',
      'The initial offering and sale of securities to the public',
      'Ongoing reporting requirements for public companies',
      'The regulation of securities exchanges',
    ],
    a: 1,
    r: "The Securities Act of 1933 is known as the 'Truth in Securities' law. It requires companies offering securities to the public for the first time to register the offering with the SEC and provide investors with full and fair disclosure through a prospectus.",
    src: 'finra-public',
  },
  {
    s: 'S4',
    t: 'Investor Protection',
    q: 'SIPC provides protection for customer accounts up to:',
    o: [
      '$250,000 per account',
      '$500,000 per customer, with a $250,000 limit on cash claims',
      '$500,000 per account for all assets',
      '$1,000,000 for retirement accounts',
    ],
    a: 1,
    r: "The Securities Investor Protection Corporation (SIPC) provides up to $500,000 of protection per customer, but no more than $250,000 of that may be for cash claims. SIPC does not protect against investment losses—it protects against broker-dealer failure and missing securities.",
    src: 'finra-public',
  },
  {
    s: 'S4',
    t: 'Regulatory Bodies',
    q: 'FINRA is best described as:',
    o: [
      'A government agency that regulates all financial institutions',
      'A self-regulatory organization (SRO) that oversees broker-dealers',
      'A division of the Securities and Exchange Commission',
      'A non-profit organization that provides investor education only',
    ],
    a: 1,
    r: 'FINRA (Financial Industry Regulatory Authority) is a self-regulatory organization (SRO) authorized by Congress to regulate broker-dealers. It writes and enforces rules for broker-dealers, examines firms for compliance, and provides dispute resolution services. FINRA is not a government agency.',
    src: 'finra-public',
  },
  {
    s: 'S4',
    t: 'Investor Protection',
    q: "Under SEC Rule 10b-5, it is unlawful to:",
    o: [
      'Charge high commissions on securities transactions',
      'Make material misstatements or omissions in connection with the purchase or sale of securities',
      'Fail to register as a broker-dealer',
      'Sell securities without prior approval from the SEC',
    ],
    a: 1,
    r: 'SEC Rule 10b-5 is a broad anti-fraud rule that makes it unlawful to make material misstatements or omissions, use deceptive devices, or employ any scheme to defraud in connection with the purchase or sale of securities. Insider trading violations are typically prosecuted under Rule 10b-5.',
    src: 'finra-public',
  },
];

// ── Topic Plan: 1,465 original questions ──────────────────────────────────────
// Format: { s, t, count, hints }
const TOPIC_PLAN = [
  // S1 — 240 original + 7 FINRA public = 247 total
  {
    s: 'S1',
    t: 'Primary Markets',
    count: 35,
    hints: 'IPOs, underwriting process, firm commitment vs best efforts, red herring prospectus, registration statement, SEC review period, pricing, allocation, stabilization',
  },
  {
    s: 'S1',
    t: 'Secondary Markets',
    count: 30,
    hints: 'NYSE, NASDAQ, OTC markets, third and fourth markets, market makers, specialists, trading venues, ATS, dark pools, quote-driven vs order-driven',
  },
  {
    s: 'S1',
    t: 'Market Structure',
    count: 30,
    hints: 'Exchange-listed vs OTC, bid-ask spread, depth of market, ECNs, market centers, trading halts, circuit breakers, NBBO, locked/crossed markets',
  },
  {
    s: 'S1',
    t: 'Economic Factors',
    count: 35,
    hints: 'GDP, inflation, deflation, stagflation, business cycle, fiscal policy, trade deficits, interest rates, currency exchange, economic indicators, CPI, PPI',
  },
  {
    s: 'S1',
    t: 'Monetary Policy',
    count: 30,
    hints: 'Federal Reserve, FOMC, discount rate, federal funds rate, reserve requirements, open market operations, quantitative easing, money supply, tightening vs easing',
  },
  {
    s: 'S1',
    t: 'Market Participants',
    count: 30,
    hints: 'Broker-dealers, institutional investors, retail investors, market makers, transfer agents, custodians, clearing firms, issuers, underwriters, investment bankers',
  },
  {
    s: 'S1',
    t: 'Capital Formation',
    count: 30,
    hints: 'Equity vs debt financing, private placement, shelf registration, Reg A+, crowdfunding, tombstone ads, prospectus delivery, cooling-off period, due diligence',
  },
  {
    s: 'S1',
    t: 'Market Indices',
    count: 20,
    hints: 'DJIA, S&P 500, NASDAQ Composite, Russell 2000, price-weighted vs market-cap weighted, index funds, benchmark comparison, sector indices',
  },

  // S2 — 660 original + 14 FINRA public = 674 total
  {
    s: 'S2',
    t: 'Equity Securities',
    count: 90,
    hints: 'Common stock rights (voting, dividends, liquidation), EPS, P/E ratio, market cap, growth vs value, dividend yield, stock splits, reverse splits, spin-offs, tender offers, rights offerings, preemptive rights, treasury stock, authorized/issued/outstanding shares',
  },
  {
    s: 'S2',
    t: 'Preferred Stock',
    count: 50,
    hints: 'Cumulative, non-cumulative, participating, convertible preferred, callable preferred, adjustable-rate preferred, priority in dividends and liquidation, par value, dividend rate, conversion ratio',
  },
  {
    s: 'S2',
    t: 'Debt Securities - Basics',
    count: 70,
    hints: 'Bond indenture, coupon rate, par value, yield to maturity, yield to call, current yield, discount vs premium bonds, duration, convexity, interest rate risk, accrued interest, callable bonds, convertible bonds, zero-coupon bonds, bond rating agencies, investment grade vs junk',
  },
  {
    s: 'S2',
    t: 'US Government Securities',
    count: 65,
    hints: 'T-bills, T-notes, T-bonds, TIPS, Treasury STRIPS, EE bonds, I bonds, agency securities, Ginnie Mae, Fannie Mae, Freddie Mac, government-sponsored enterprises, auction process, repo agreements',
  },
  {
    s: 'S2',
    t: 'Municipal Securities',
    count: 65,
    hints: 'General obligation bonds, revenue bonds, industrial development bonds, tax equivalent yield, AMT, insured munis, pre-refunded bonds, advance refunding, CUSIP, MSRB rules, competitive vs negotiated sale, bond counsel opinion',
  },
  {
    s: 'S2',
    t: 'Corporate Bonds',
    count: 60,
    hints: 'Secured vs unsecured debentures, subordinated debt, senior debt, covenants, protective provisions, sinking fund, call provisions, make-whole call, bond indenture trustee, investment grade, high yield, bond pricing, spread to Treasury',
  },
  {
    s: 'S2',
    t: 'Mutual Funds',
    count: 60,
    hints: 'Open-end vs closed-end, NAV calculation, sales loads (A/B/C shares), 12b-1 fees, expense ratio, diversification, prospectus, fund objectives, redemption, breakpoints, letter of intent, rights of accumulation, money market funds',
  },
  {
    s: 'S2',
    t: 'ETFs and Closed-End Funds',
    count: 50,
    hints: 'Creation/redemption mechanism, authorized participants, premium/discount to NAV, passive vs active ETFs, leveraged ETFs, inverse ETFs, closed-end fund IPOs, rights offerings for closed-end funds, intraday trading, bid-ask spread',
  },
  {
    s: 'S2',
    t: 'Options',
    count: 65,
    hints: 'Calls and puts, strike price, expiration, premium, intrinsic value, time value, in/at/out of the money, long vs short positions, covered calls, protective puts, straddles, spreads, OCC, options on indices, exercise and assignment, max gain/loss calculations',
  },
  {
    s: 'S2',
    t: 'Variable Annuities',
    count: 40,
    hints: 'Accumulation units, annuity units, sub-accounts, separate account, mortality and expense risk charge, surrender charges, death benefit, annuitization options, tax-deferred growth, suitability concerns, 1035 exchange, FINRA supervision requirements',
  },
  {
    s: 'S2',
    t: 'Alternative Investments',
    count: 35,
    hints: 'REITs, master limited partnerships (MLPs), hedge funds, private equity, commodities, structured products, DPPs (direct participation programs), limited partnerships, risk factors, liquidity concerns, accredited investors',
  },
  {
    s: 'S2',
    t: 'Investment Risks',
    count: 10,
    hints: 'Systematic vs unsystematic risk, market risk, credit risk, liquidity risk, inflation risk, reinvestment risk, currency risk, concentration risk, beta, standard deviation, diversification benefits',
  },

  // S3 — 465 original + 10 FINRA public = 475 total
  {
    s: 'S3',
    t: 'Order Types',
    count: 65,
    hints: 'Market orders, limit orders, stop orders, stop-limit orders, trailing stops, good-till-cancelled (GTC), day orders, fill-or-kill (FOK), immediate-or-cancel (IOC), all-or-none (AON), order routing, price improvement, short sales, buy to cover',
  },
  {
    s: 'S3',
    t: 'Trade Settlement',
    count: 40,
    hints: 'T+1 for government securities, T+2 for equities and corporate/muni bonds, cash settlement, delivery vs payment, DTC, DTCC, NSCC, fails to deliver, good delivery, transfer of ownership, confirmations and statements',
  },
  {
    s: 'S3',
    t: 'Customer Account Types',
    count: 70,
    hints: 'Individual accounts, joint tenants with right of survivorship, tenants in common, TOD (transfer on death), custodial accounts (UGMA/UTMA), trust accounts, corporate accounts, partnership accounts, discretionary accounts, power of attorney, new account documentation',
  },
  {
    s: 'S3',
    t: 'Margin Accounts',
    count: 55,
    hints: 'Regulation T (50% initial), FINRA 25% maintenance margin, house requirements, margin calls, SMA (special memorandum account), buying power, hypothecation, rehypothecation, short selling requirements, pattern day trading rules',
  },
  {
    s: 'S3',
    t: 'Retirement Accounts',
    count: 55,
    hints: 'Traditional IRA, Roth IRA, SEP-IRA, SIMPLE IRA, 401(k), 403(b), 457 plans, contribution limits, income limits, required minimum distributions (RMDs), rollovers vs transfers, early withdrawal penalties, Coverdell ESA, 529 plans',
  },
  {
    s: 'S3',
    t: 'Prohibited Activities',
    count: 90,
    hints: 'Churning, front-running, insider trading, misrepresentation, omission of material facts, unauthorized transactions, unsuitable recommendations, market manipulation, excessive markups, free-riding, spinning, laddering, pump and dump, wash sales, matched orders',
  },
  {
    s: 'S3',
    t: 'Customer Communications',
    count: 45,
    hints: 'FINRA Rule 2210 (retail vs institutional communications), filing requirements, principal approval, social media, correspondence, public appearances, testimonials, endorsements, record retention, fair and balanced presentations',
  },
  {
    s: 'S3',
    t: 'Anti-Money Laundering',
    count: 45,
    hints: 'Bank Secrecy Act, FinCEN, CTR ($10,000 threshold), SAR filing, structuring, customer identification program (CIP), beneficial ownership rules, OFAC sanctions, red flags, AML training requirements, politically exposed persons (PEPs)',
  },

  // S4 — 135 original + 4 FINRA public = 139 total
  {
    s: 'S4',
    t: 'Securities Act of 1933',
    count: 25,
    hints: 'Registration requirements, exemptions (Reg A, Reg D, Rule 144A, intrastate offerings), prospectus delivery, quiet period, free writing prospectus, material misstatements, civil liability, SEC review',
  },
  {
    s: 'S4',
    t: 'Securities Exchange Act of 1934',
    count: 25,
    hints: 'SEC creation, broker-dealer registration (Form BD), exchange regulation, reporting requirements (10-K, 10-Q, 8-K), proxy rules, short-swing profit rule (Section 16), market manipulation (Section 9), antifraud (Rule 10b-5), Regulation SHO',
  },
  {
    s: 'S4',
    t: 'Investment Company Act',
    count: 20,
    hints: 'Investment company definition and registration, open-end vs closed-end, management companies, unit investment trusts, diversification requirements, leverage limits, affiliated transactions, 40 Act exemptions, private funds',
  },
  {
    s: 'S4',
    t: 'FINRA Rules and Registration',
    count: 30,
    hints: 'Registration categories (SIE, Series 6, 7, 63, 65, 66), Form U4/U5, fingerprinting, statutory disqualification, continuing education (Regulatory Element, Firm Element), supervision, books and records, FINRA arbitration, Rule 4210, Rule 2010',
  },
  {
    s: 'S4',
    t: 'Regulatory Bodies',
    count: 20,
    hints: 'SEC, FINRA, MSRB, SIPC, state securities regulators, Federal Reserve, CFTC, OCC, FDIC, FinCEN, OFAC, SRO framework, concurrent jurisdiction, Dodd-Frank Act',
  },
  {
    s: 'S4',
    t: 'Investor Protection',
    count: 15,
    hints: 'SIPC coverage limits, investor rights, suitability (Reg BI), best interest standard, conflicts of interest disclosure, Regulation Best Interest, Form CRS, fiduciary vs suitability, arbitration vs litigation, expungement',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sleep for ms milliseconds. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Load or initialise progress state from disk. */
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      const raw = fs.readFileSync(PROGRESS_FILE, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Warning: could not parse progress file — starting fresh.', e.message);
    }
  }
  return { completed: [], questions: [] };
}

/** Persist progress to disk. */
function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');
}

/**
 * Build the Claude prompt for a given topic entry.
 */
function buildPrompt(topicEntry) {
  const { s, t, count, hints } = topicEntry;
  return `You are writing original SIE exam practice questions for a free study platform.

Generate exactly ${count} multiple-choice questions about: ${t} (section ${s})
Subtopic hints: ${hints}

Rules:
- Accurate to current FINRA SIE exam content
- Each question has exactly 4 answer choices
- Only one correct answer per question
- No letter prefixes (A, B, C, D) on choices
- Rationale explains WHY the answer is correct (2-4 sentences)
- Questions must be original (not copied from any source)
- Vary difficulty: ~40% easy, 40% medium, 20% hard
- Do not repeat questions within this batch
- Answers should not always be choice A or B — vary the correct answer position across 0, 1, 2, and 3

Return ONLY a JSON array, no other text:
[
  {"q": "Question text?", "o": ["Choice1","Choice2","Choice3","Choice4"], "a": 0, "r": "Rationale."},
  ...
]`;
}

/**
 * Call the Anthropic API for a single topic batch, with retry logic.
 * Returns an array of parsed question objects.
 */
async function generateBatch(client, topicEntry, batchLabel) {
  const { count } = topicEntry;
  const prompt = buildPrompt(topicEntry);
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        const backoffMs = Math.min(2 ** (attempt - 1) * 2000, 32000);
        console.log(`  Retry ${attempt}/${MAX_RETRIES} for ${batchLabel} in ${backoffMs / 1000}s...`);
        await sleep(backoffMs);
      }

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      });

      const rawText = response.content[0].text.trim();

      // Strip any markdown code fence if present
      const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch (parseErr) {
        console.warn(`  JSON parse failed for ${batchLabel}: ${parseErr.message}`);
        // Try to extract the JSON array from the text
        const match = jsonText.match(/(\[[\s\S]*\])/);
        if (match) {
          parsed = JSON.parse(match[1]);
        } else {
          throw new Error(`Could not extract JSON array from response: ${rawText.slice(0, 200)}`);
        }
      }

      if (!Array.isArray(parsed)) {
        throw new Error(`Response is not a JSON array`);
      }

      // Validate each question object
      const validated = [];
      for (let i = 0; i < parsed.length; i++) {
        const q = parsed[i];
        if (
          typeof q.q !== 'string' ||
          !Array.isArray(q.o) ||
          q.o.length !== 4 ||
          typeof q.a !== 'number' ||
          q.a < 0 ||
          q.a > 3 ||
          typeof q.r !== 'string'
        ) {
          console.warn(`  Skipping malformed question at index ${i} in ${batchLabel}`);
          continue;
        }
        validated.push(q);
      }

      if (validated.length < count) {
        console.warn(
          `  Warning: expected ${count} questions, got ${validated.length} for ${batchLabel}.`,
        );
        if (validated.length === 0) {
          throw new Error('Zero valid questions returned');
        }
        // Accept partial results rather than retrying endlessly
        if (attempt < MAX_RETRIES && validated.length < Math.ceil(count * 0.9)) {
          throw new Error(
            `Only ${validated.length}/${count} questions valid, retrying for better coverage`,
          );
        }
      }

      return validated;
    } catch (err) {
      lastError = err;
      const status = err.status || (err.error && err.error.status);
      const isRateLimit = status === 429;
      const isServerError = status === 500 || status === 529;

      if (!isRateLimit && !isServerError && attempt > 1) {
        // Non-retriable after first attempt unless it's a rate limit or server error
        if (attempt >= MAX_RETRIES) break;
      }

      console.warn(`  Attempt ${attempt} failed for ${batchLabel}: ${err.message}`);
    }
  }

  throw new Error(`All ${MAX_RETRIES} attempts failed for ${batchLabel}: ${lastError?.message}`);
}

/**
 * Fisher-Yates shuffle in place.
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Assign sequential IDs to questions grouped by section.
 * Each section is shuffled first, then IDs are assigned in order.
 */
function assignIds(allQuestions) {
  const sections = ['S1', 'S2', 'S3', 'S4'];
  const result = [];

  for (const section of sections) {
    const sectionQs = allQuestions.filter((q) => q.s === section);
    shuffle(sectionQs);
    sectionQs.forEach((q, idx) => {
      const num = String(idx + 1).padStart(3, '0');
      result.push({ ...q, id: `${section}-${num}` });
    });
  }

  return result;
}

/**
 * Serialize a question object to a single-line JS object literal.
 */
function serializeQuestion(q) {
  const escape = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const choices = q.o.map((c) => `"${escape(c)}"`).join(',');
  return (
    `{id:"${q.id}",s:"${q.s}",t:"${escape(q.t)}",` +
    `q:"${escape(q.q)}",` +
    `o:[${choices}],` +
    `a:${q.a},` +
    `r:"${escape(q.r)}",` +
    `src:"${q.src}"}`
  );
}

/**
 * Write the final questions.js output file.
 */
function writeOutput(questions) {
  const lines = questions.map((q) => '  ' + serializeQuestion(q));
  const content = `const DB=[\n${lines.join(',\n')}\n];\n`;
  fs.writeFileSync(OUTPUT_FILE, content, 'utf8');
  console.log(`\nWrote ${questions.length} questions to ${OUTPUT_FILE}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const client = new Anthropic();
  const progress = loadProgress();

  console.log('=== SIE Question Generator ===');
  console.log(`Model: ${MODEL}`);
  console.log(`Topics: ${TOPIC_PLAN.length}`);
  console.log(
    `Previously completed: ${progress.completed.length}/${TOPIC_PLAN.length} topics`,
  );
  console.log(`Questions so far: ${progress.questions.length}`);
  console.log('');

  // Process each topic in the plan
  for (let i = 0; i < TOPIC_PLAN.length; i++) {
    const topicEntry = TOPIC_PLAN[i];
    const key = `${topicEntry.s}-${topicEntry.t}`;

    if (progress.completed.includes(key)) {
      console.log(`[${i + 1}/${TOPIC_PLAN.length}] Skipping ${key} (already done)`);
      continue;
    }

    console.log(
      `[${i + 1}/${TOPIC_PLAN.length}] Generating ${topicEntry.s} — ${topicEntry.t}... (${topicEntry.count} questions)`,
    );

    const questions = await generateBatch(client, topicEntry, key);

    // Attach section, topic, and src metadata
    const enriched = questions.map((q) => ({
      s: topicEntry.s,
      t: topicEntry.t,
      q: q.q,
      o: q.o,
      a: q.a,
      r: q.r,
      src: 'original',
    }));

    progress.questions.push(...enriched);
    progress.completed.push(key);
    saveProgress(progress);

    console.log(`  ✓ Got ${questions.length} questions (total: ${progress.questions.length})`);
  }

  // Combine FINRA public + generated questions
  console.log('\nCombining FINRA public questions with generated questions...');
  const allQuestions = [...FINRA_PUBLIC, ...progress.questions];

  // Assign IDs and shuffle within sections
  const finalQuestions = assignIds(allQuestions);

  // Report counts by section
  const sections = ['S1', 'S2', 'S3', 'S4'];
  for (const s of sections) {
    const count = finalQuestions.filter((q) => q.s === s).length;
    const finraCount = FINRA_PUBLIC.filter((q) => q.s === s).length;
    const origCount = progress.questions.filter((q) => q.s === s).length;
    console.log(`  ${s}: ${count} total (${finraCount} FINRA public + ${origCount} original)`);
  }

  // Write output
  writeOutput(finalQuestions);

  // Summary
  const totalOriginal = progress.questions.length;
  const totalFinra = FINRA_PUBLIC.length;
  console.log(`\n=== Summary ===`);
  console.log(`FINRA public questions: ${totalFinra}`);
  console.log(`Generated original questions: ${totalOriginal}`);
  console.log(`Total questions: ${finalQuestions.length}`);
  console.log(
    `Generated ${totalOriginal} questions across 4 sections`,
  );

  // Clean up progress file on success
  if (fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
    console.log('Progress file cleaned up.');
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
