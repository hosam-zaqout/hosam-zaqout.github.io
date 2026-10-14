// قائمة الدول: ISO | مفتاح الاتصال | الاسم بالعربي | الاسم بالإنجليزي
// المصدر الوحيد — assets/countries.js بيتولّد منها (node functions/countries.js --web)
"use strict";
const RAW = `PS|970|فلسطين|Palestine
JO|962|الأردن|Jordan
SA|966|السعودية|Saudi Arabia
EG|20|مصر|Egypt
AE|971|الإمارات|United Arab Emirates
QA|974|قطر|Qatar
KW|965|الكويت|Kuwait
BH|973|البحرين|Bahrain
OM|968|عُمان|Oman
YE|967|اليمن|Yemen
IQ|964|العراق|Iraq
SY|963|سوريا|Syria
LB|961|لبنان|Lebanon
LY|218|ليبيا|Libya
TN|216|تونس|Tunisia
DZ|213|الجزائر|Algeria
MA|212|المغرب|Morocco
MR|222|موريتانيا|Mauritania
SD|249|السودان|Sudan
SO|252|الصومال|Somalia
DJ|253|جيبوتي|Djibouti
KM|269|جزر القمر|Comoros
IL|972|فلسطين (972)|Palestine
TR|90|تركيا|Turkey
IR|98|إيران|Iran
AF|93|أفغانستان|Afghanistan
PK|92|باكستان|Pakistan
IN|91|الهند|India
BD|880|بنغلاديش|Bangladesh
LK|94|سريلانكا|Sri Lanka
NP|977|نيبال|Nepal
MV|960|جزر المالديف|Maldives
MY|60|ماليزيا|Malaysia
ID|62|إندونيسيا|Indonesia
SG|65|سنغافورة|Singapore
TH|66|تايلاند|Thailand
VN|84|فيتنام|Vietnam
PH|63|الفلبين|Philippines
CN|86|الصين|China
HK|852|هونغ كونغ|Hong Kong
TW|886|تايوان|Taiwan
JP|81|اليابان|Japan
KR|82|كوريا الجنوبية|South Korea
KZ|7|كازاخستان|Kazakhstan
UZ|998|أوزبكستان|Uzbekistan
TM|993|تركمانستان|Turkmenistan
KG|996|قيرغيزستان|Kyrgyzstan
TJ|992|طاجيكستان|Tajikistan
AZ|994|أذربيجان|Azerbaijan
GE|995|جورجيا|Georgia
AM|374|أرمينيا|Armenia
CY|357|قبرص|Cyprus
GB|44|المملكة المتحدة|United Kingdom
IE|353|أيرلندا|Ireland
DE|49|ألمانيا|Germany
FR|33|فرنسا|France
IT|39|إيطاليا|Italy
ES|34|إسبانيا|Spain
PT|351|البرتغال|Portugal
NL|31|هولندا|Netherlands
BE|32|بلجيكا|Belgium
LU|352|لوكسمبورغ|Luxembourg
CH|41|سويسرا|Switzerland
AT|43|النمسا|Austria
DK|45|الدنمارك|Denmark
SE|46|السويد|Sweden
NO|47|النرويج|Norway
FI|358|فنلندا|Finland
IS|354|آيسلندا|Iceland
PL|48|بولندا|Poland
CZ|420|التشيك|Czech Republic
SK|421|سلوفاكيا|Slovakia
HU|36|المجر|Hungary
RO|40|رومانيا|Romania
BG|359|بلغاريا|Bulgaria
GR|30|اليونان|Greece
MT|356|مالطا|Malta
SI|386|سلوفينيا|Slovenia
HR|385|كرواتيا|Croatia
BA|387|البوسنة والهرسك|Bosnia and Herzegovina
RS|381|صربيا|Serbia
ME|382|الجبل الأسود|Montenegro
MK|389|مقدونيا الشمالية|North Macedonia
AL|355|ألبانيا|Albania
XK|383|كوسوفو|Kosovo
UA|380|أوكرانيا|Ukraine
BY|375|بيلاروسيا|Belarus
MD|373|مولدوفا|Moldova
LT|370|ليتوانيا|Lithuania
LV|371|لاتفيا|Latvia
EE|372|إستونيا|Estonia
RU|7|روسيا|Russia
US|1|الولايات المتحدة|United States
CA|1|كندا|Canada
MX|52|المكسيك|Mexico
BR|55|البرازيل|Brazil
AR|54|الأرجنتين|Argentina
CL|56|تشيلي|Chile
CO|57|كولومبيا|Colombia
PE|51|بيرو|Peru
VE|58|فنزويلا|Venezuela
EC|593|الإكوادور|Ecuador
BO|591|بوليفيا|Bolivia
PY|595|باراغواي|Paraguay
UY|598|الأوروغواي|Uruguay
CU|53|كوبا|Cuba
DO|1|جمهورية الدومينيكان|Dominican Republic
PA|507|بنما|Panama
CR|506|كوستاريكا|Costa Rica
GT|502|غواتيمالا|Guatemala
HN|504|هندوراس|Honduras
SV|503|السلفادور|El Salvador
NI|505|نيكاراغوا|Nicaragua
AU|61|أستراليا|Australia
NZ|64|نيوزيلندا|New Zealand
ZA|27|جنوب أفريقيا|South Africa
NG|234|نيجيريا|Nigeria
GH|233|غانا|Ghana
KE|254|كينيا|Kenya
ET|251|إثيوبيا|Ethiopia
ER|291|إريتريا|Eritrea
TZ|255|تنزانيا|Tanzania
UG|256|أوغندا|Uganda
RW|250|رواندا|Rwanda
SN|221|السنغال|Senegal
ML|223|مالي|Mali
NE|227|النيجر|Niger
TD|235|تشاد|Chad
CM|237|الكاميرون|Cameroon
CI|225|ساحل العاج|Ivory Coast
GN|224|غينيا|Guinea
BF|226|بوركينا فاسو|Burkina Faso
ZM|260|زامبيا|Zambia
ZW|263|زيمبابوي|Zimbabwe
MZ|258|موزمبيق|Mozambique
AO|244|أنغولا|Angola
CD|243|الكونغو الديمقراطية|DR Congo
CG|242|الكونغو|Congo
GA|241|الغابون|Gabon
MG|261|مدغشقر|Madagascar
MU|230|موريشيوس|Mauritius
SS|211|جنوب السودان|South Sudan`;

const LIST = RAW.split("\n").map((l) => { const [iso, dial, ar, en] = l.split("|"); return { iso, dial, ar, en }; });
const BY_ISO = Object.fromEntries(LIST.map((c) => [c.iso, c]));
module.exports = { LIST, BY_ISO };

// توليد نسخة المتصفح
if (require.main === module && process.argv.includes("--web")) {
  const fs = require("fs"), path = require("path");
  const out = "// مولّد من functions/countries.js — لا تعدّله يدوياً\nwindow.COUNTRIES3=" + JSON.stringify(LIST.map((c) => [c.iso, c.dial, c.ar])) + ";\n";
  fs.writeFileSync(path.join(__dirname, "..", "assets", "countries.js"), out);
  console.log("assets/countries.js:", LIST.length);
}
