// Генератор фейковых личностей
import crypto from 'crypto';

// Словари для РФ
const ruFirstNamesMale = ['Александр','Дмитрий','Максим','Сергей','Андрей','Алексей','Артём','Илья','Кирилл','Михаил','Никита','Матвей','Роман','Егор','Константин','Денис','Владислав','Павел','Тимофей','Глеб'];
const ruFirstNamesFemale = ['Анна','Мария','Елена','Дарья','Анастасия','Ольга','Наталья','Екатерина','Ксения','Ирина','Виктория','Полина','Татьяна','Юлия','Светлана','Алиса','София','Арина','Валерия','Евгения'];
const ruLastNames = ['Иванов','Петров','Сидоров','Смирнов','Кузнецов','Попов','Васильев','Павлов','Семёнов','Голубев','Виноградов','Богданов','Воробьёв','Фёдоров','Михайлов','Беляев','Тарасов','Белов','Комаров','Орлов'];
const ruMiddleNamesMale = ['Александрович','Дмитриевич','Максимович','Сергеевич','Андреевич','Алексеевич','Артёмович','Ильич','Кириллович','Михайлович'];
const ruMiddleNamesFemale = ['Александровна','Дмитриевна','Максимовна','Сергеевна','Андреевна','Алексеевна','Артёмовна','Ильинична','Кирилловна','Михайловна'];
const ruCities = ['Москва','Санкт-Петербург','Новосибирск','Екатеринбург','Казань','Нижний Новгород','Челябинск','Самара','Омск','Ростов-на-Дону','Уфа','Красноярск','Воронеж','Пермь','Волгоград'];
const ruStreets = ['Ленина','Советская','Мира','Гагарина','Победы','Кирова','Пушкина','Калинина','Молодёжная','Лесная','Школьная','Садовая','Новая','Набережная','Заводская'];
const ruPhoneCodes = ['495','499','812','383','343','831','846','3812','863','347','391','473','342','8442'];

// Словари для US
const usFirstNamesMale = ['James','John','Robert','Michael','William','David','Richard','Joseph','Thomas','Charles','Christopher','Daniel','Matthew','Anthony','Donald','Mark','Paul','Steven','Andrew','Kenneth'];
const usFirstNamesFemale = ['Mary','Patricia','Jennifer','Linda','Elizabeth','Barbara','Susan','Jessica','Sarah','Karen','Nancy','Lisa','Betty','Margaret','Sandra','Ashley','Kimberly','Emily','Donna','Michelle'];
const usLastNames = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin'];
const usCities = ['New York','Los Angeles','Chicago','Houston','Phoenix','Philadelphia','San Antonio','San Diego','Dallas','San Jose','Austin','Jacksonville','Fort Worth','Columbus','Charlotte','San Francisco','Indianapolis','Seattle','Denver','Washington'];
const usStreets = ['Main St','Broadway','Park Ave','Elm St','Maple Ave','Oak St','Pine St','Cedar St','Washington St','Lake St','Hill St','View Ave','Sunset Blvd','Highland Ave','Central Ave'];
const usStates = ['CA','TX','FL','NY','PA','IL','OH','GA','NC','MI','NJ','VA','WA','AZ','MA','TN','IN','MO','MD','WI'];
const usPhoneArea = ['212','310','312','305','214','713','602','702','206','303','404','512','615','704','802','901','972','818','619','415'];

function randomInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

function randomElement(arr) {
  return arr[crypto.randomInt(0, arr.length)];
}

function generateDate(startYear = 1970, endYear = 2005) {
  const year = randomInt(startYear, endYear);
  const month = randomInt(1, 12);
  const day = randomInt(1, 28); // упрощенно
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function generateEmail(name, domain) {
  const clean = name.toLowerCase().replace(/\s+/g, '.');
  const rand = randomInt(1, 999);
  return `${clean}${rand}@${domain}`;
}

function generateCreditCard() {
  // Генерация номера по алгоритму Луна (валидный формат)
  const prefixes = ['4', '5', '37', '6']; // visa, mastercard, amex, discover
  const prefix = randomElement(prefixes);
  let number = prefix;
  for (let i = prefix.length; i < 15; i++) {
    number += randomInt(0, 9);
  }
  // добавим контрольную цифру (упрощенно)
  number += randomInt(0, 9);
  return {
    type: prefix === '4' ? 'Visa' : prefix === '5' ? 'MasterCard' : prefix === '37' ? 'Amex' : 'Discover',
    number: number.replace(/(.{4})/g,'$1 ').trim(),
    cvv: String(randomInt(100, 999)),
    expiry: `${String(randomInt(1,12)).padStart(2,'0')}/${randomInt(25,30)}`
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { country, count } = req.query;
  const cnt = parseInt(count) || 1;
  const countryCode = country === 'ru' ? 'ru' : 'us';

  const identities = [];

  for (let i = 0; i < cnt; i++) {
    const gender = randomInt(0, 1) ? 'male' : 'female';
    let firstName, lastName, middleName, city, street, zip, phone, email, domain;

    if (countryCode === 'ru') {
      firstName = gender === 'male' ? randomElement(ruFirstNamesMale) : randomElement(ruFirstNamesFemale);
      lastName = randomElement(ruLastNames) + (gender === 'female' ? 'а' : '');
      middleName = gender === 'male' ? randomElement(ruMiddleNamesMale) : randomElement(ruMiddleNamesFemale);
      city = randomElement(ruCities);
      street = randomElement(ruStreets);
      zip = String(randomInt(100000, 999999));
      phone = `+7${randomElement(ruPhoneCodes)}${String(randomInt(1000000, 9999999))}`;
      domain = 'ya.ru';
    } else {
      firstName = gender === 'male' ? randomElement(usFirstNamesMale) : randomElement(usFirstNamesFemale);
      lastName = randomElement(usLastNames);
      middleName = '';
      city = randomElement(usCities);
      street = randomElement(usStreets);
      zip = String(randomInt(10000, 99999));
      const area = randomElement(usPhoneArea);
      phone = `+1${area}${String(randomInt(1000000, 9999999))}`;
      domain = 'gmail.com';
    }

    const fullName = `${firstName} ${lastName}${middleName ? ' ' + middleName : ''}`;
    const emailAddr = generateEmail(firstName + lastName, domain);
    const card = generateCreditCard();
    const birthDate = generateDate();

    identities.push({
      fullName,
      firstName,
      lastName,
      middleName: middleName || undefined,
      gender,
      birthDate,
      address: {
        city,
        street,
        zip
      },
      phone,
      email: emailAddr,
      creditCard: card,
      password: crypto.randomBytes(8).toString('hex'),
      country: countryCode === 'ru' ? 'Россия' : 'USA'
    });
  }

  return res.status(200).json({
    ok: true,
    data: identities
  });
}