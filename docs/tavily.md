# یکپارچه‌سازی Tavily (v15.25 · سرور 1.19)

Tavily در همهٔ بخش‌های پژوهش، پایش، جست‌وجو و استخراج سامانه به‌کار رفته است. همهٔ نقاط پایانی رسمی پوشش داده شده‌اند: Search، Extract، Crawl، Map، Research (ساخت و پیگیری وضعیت) و Usage. فراخوانی‌ها همگی از یک کلاینت کنترل‌شده در سرور (`dev/src/p5/s_tavily.js`) رد می‌شوند. این کلاینت پیش از هر فراخوانی این‌ها را اعمال می‌کند:

- **کلید توقف:** `IFA_TAVILY_OFF=1`، `IFA_WEB_OFF=1` یا `IFA_LIVE_OFF=web`
- **نگهبان نشانی:** نشانی‌های محلی و شبکهٔ داخلی، و فهرست دامنه‌های مجاز و مسدودِ «دادهٔ وب»
- **سقف اعتبار:** روزانه، ماهانه و روزانهٔ عامل‌ها (بر حسب کردیت)، به‌علاوهٔ بودجهٔ دلاری مشترک دادهٔ وب
- **تکرار خودکار:** هنگام خطای 429 یا 5xx
- **ثبت مصرف:** در جدول `web_usage` با `svc = 'tv'` و مقدار کردیت واقعیِ بازگشتی از Tavily (`include_usage`)
- **محتوای نامطمئن:** متن صفحه‌ها برای نشانه‌های تزریق دستور بررسی می‌شود، و عامل‌هایی که وب می‌خوانند اجازهٔ ارسال، تعهد یا پرداخت ندارند

## راه‌اندازی
1. کلید را **فقط** در `.env` سرور بگذارید (`IFA_TAVILY_KEY=tvly-...`) یا در «دادهٔ وب › Tavily › کلید و سقف‌ها» وارد کنید. کلید هرگز به مرورگر برنمی‌گردد و فقط به‌صورت پوشیده (`tvly-…abcd`) نمایش داده می‌شود.
2. `npm run probe:tavily` همهٔ مسیرها را با کلید واقعی آزمایش می‌کند و حدود ۶ کردیت مصرف می‌کند. با `--research` یک پژوهش `mini` هم اجرا می‌شود.
3. سقف‌ها را تنظیم کنید. پیش‌فرض‌ها: ۲۰۰ کردیت در روز، ۱۵۰۰ در ماه و ۶۰ برای عامل‌ها در روز. سقف را با `IFA_TAVILY_*_CREDITS` یا از رابط کاربری تغییر دهید. اگر مقدار در `.env` تعیین شده باشد، بر مقدار رابط کاربری اولویت دارد.

## نقاط پایانی Tavily و محل استفاده
| Tavily | API سرور | ابزار عامل/MCP | جاهای دیگر |
|---|---|---|---|
| `POST /search` | `POST /api/tavily/search` | `tavily_search` | زنجیرهٔ `web_search` دستیار صفحه؛ پایشگرهای خبری؛ جایگزین Exa در جاروی خبر ریسک/گمرک/جاده و ابزار `exa_search`؛ یافتن فورواردر؛ غربال طرف معامله؛ خبر زندهٔ خودکارگردان؛ الگوهای `tv_risk_watch` و `tv_market_brief` |
| `POST /extract` | `POST /api/tavily/extract` | `tavily_extract` | یافتن فورواردر (ایمیل، تلفن و خدمات از سایت خود شرکت) |
| `POST /crawl` | `POST /api/tavily/crawl`، `POST /api/tavily/site` | `tavily_crawl` | پروفایل تأمین‌کننده یا فورواردر (`web_party.profile`) |
| `POST /map` | `POST /api/tavily/map` | `tavily_map` | یافتن صفحه‌های تماس، نرخ و اطلاعیه |
| `POST /research` | `POST /api/tavily/research` (`engine: 'tv'` در `/api/web/research` هم کار می‌کند) | `tavily_research` | فهرست مشترک «پژوهش‌ها»، حافظهٔ سازمانی، اعلان `web.research`، الگوی `tv_deep_research`، گردش‌کار رانتایم `deep-research` |
| `GET /research/{id}` | پیگیری خودکار هر `IFA_TAVILY_POLL_SEC` ثانیه، و `POST /api/tavily/research/:id/poll` | `tavily_research_get` | — |
| `GET /usage` | `GET /api/tavily/usage` | `tavily_usage` | کارت مصرف در رابط کاربری |

مسیرهای دیگر:
- `GET /api/tavily/status`: وضعیت، سقف‌ها و مصرف ماه به تفکیک عملیات
- `PUT /api/tavily/key` و `PUT /api/tavily/caps`
- `POST /api/tavily/test`: آزمایش با ۱ کردیت
- `POST /api/tavily/estimate`: برآورد کردیت پیش از اجرا
- `/api/tavily/watches`: ساخت، ویرایش، حذف، اجرا و tick پایشگرها
- `POST /api/tavily/forwarders`، `POST /api/tavily/party` و `POST /api/tavily/site`

## پارامترها
- **Search:** همهٔ پارامترهای رسمی را می‌پذیرد: `search_depth`، `topic`، `time_range`، `start_date`/`end_date` (یا `days`)، `max_results`، `chunks_per_source`، `include_answer`، `include_raw_content`، `include_images`/`include_image_descriptions`، `include_favicon`، `include_domains`/`exclude_domains`/`include_domains_mode`، `country` (فقط برای topic عمومی)، `language`/`filter_by_language`، `exact_match`، `auto_parameters`، `safe_search` و `include_published_date`/`filter_by_published_date`.
- **Extract:** `urls` (تا ۲۰ نشانی)، `query`، `chunks_per_source`، `extract_depth`، `format`، `include_images`، `include_favicon` و `timeout`.
- **Crawl و Map:** `instructions`، `max_depth`، `max_breadth`، `limit`، `select_paths`/`select_domains`/`exclude_paths`/`exclude_domains` (regex نامعتبر حذف می‌شود)، `allow_external` (پیش‌فرض: خاموش)، `extract_depth`، `format` و `timeout`.
- **Research:** `model` (`mini`/`pro`/`auto`)، `output_schema` (پیش‌فرض یک طرح ساخت‌یافته با `answer`، `findings`، `figures` و `caveats`؛ هر ویژگی باید `type` و `description` داشته باشد)، `citation_format`، `output_length`، `include_domains`/`exclude_domains` و `files`. حالت `stream` استفاده نمی‌شود، چون نتیجه با پیگیری دوره‌ای و پایدار گرفته می‌شود.

## مصرف کردیت
| عملیات | کردیت |
|---|---|
| Search | basic/fast: ۱ · advanced: ۲ |
| Extract | basic: ۱ برای هر ۵ نشانی · advanced: ۲ برای هر ۵ نشانی |
| Map | ۱ برای هر ۱۰ صفحه (با instructions: ۲) |
| Crawl | هزینهٔ Map + هزینهٔ Extract |
| Research | متغیر |

برای Research، سقف پیش از اجرا بر اساس این برآورد بررسی می‌شود: mini ≈ ۴۰، auto ≈ ۸۰ و pro ≈ ۱۲۰ کردیت. مصرف واقعی پس از پایان پژوهش، **یک بار** ثبت می‌شود.

## عامل‌ها
| عامل | ابزارهای Tavily |
|---|---|
| تحلیل‌گر | search، extract، research، research_get، usage |
| ریسک | search، extract، research، research_get |
| تدارکات | search، map، crawl، extract |
| اسناد | extract |
| رهگیری | search |
| مالی | search |
| فرایندگردان | همه |

دسترسی Extract، Crawl و Map برای عامل‌ها به «دامنه‌های مجاز عامل‌ها» محدود است. `IFA_TAVILY_AGENT_OPEN=1` این محدودیت را برمی‌دارد، ولی نشانی‌های داخلی همچنان مسدود می‌مانند. MCP و رانتایم (Mastra) این ابزارها را خودکار می‌بینند.

## امنیت کلید
کلیدی که در گفتگو، ایمیل یا هر جای عمومی دیده شده، لو رفته به حساب می‌آید. از داشبورد Tavily یک کلید تازه بسازید، کلید قبلی را باطل کنید و کلید تازه را فقط در `.env` سرور بگذارید. در CI، کلید را به‌صورت Secret با نام `TAVILY_API_KEY` تعریف کنید. آزمون زنده فقط با اجرای دستی CI (ورودی `live`) اجرا می‌شود.

## رزرو اعتبار درخواست‌های هم‌زمان
پیش از ارسال درخواست، اعتبار تخمینی به‌صورت هم‌زمان رزرو می‌شود؛ درخواست‌های موازی نمی‌توانند همگی از اعتبار باقی‌مانده استفاده کنند. پژوهش‌های queued/running نیز اعتبار تخمینی را در جدول `tv_reservations` رزرو می‌کنند؛ این رزرو با راه‌اندازی مجدد سرور باقی می‌ماند و پس از پایان کار با مصرف گزارش‌شده جایگزین می‌شود. در وضعیت Tavily، `spent.reserved` اعتبار رزروشده را جدا از مصرف قطعی نمایش می‌دهد. مقدار صریح صفر برای سقف محیطی پذیرفته می‌شود و درخواست‌های هزینه‌دار را متوقف می‌کند.

سقف محلی تضمین سقف صورت‌حساب سرویس نیست: مصرف واقعی ممکن است از تخمین بیشتر باشد، و قطع اتصال پس از پذیرش درخواست در سرویس می‌تواند ثبت محلی را ناقص کند. سقف طرح/Pay-as-you-go را در حساب Tavily نیز تنظیم کنید. اگر پژوهش در سرویس پس از timeout محلی همچنان فعال است، وضعیت و مصرف حساب را بررسی کنید. اجرای چند replica از سرور با دیتابیس‌های مستقل پشتیبانی نمی‌شود.
