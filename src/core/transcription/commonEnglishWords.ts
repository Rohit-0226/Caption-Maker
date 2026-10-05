/**
 * Everyday English words, in base form.
 *
 * The English lexicon in englishLexicon.ts is a curated list of brands and
 * loanwords, not a dictionary. Matching every token against it fuzzily turned
 * correct English into a near neighbour on real audio — "charity" became
 * "clarity", "started" became "startup", "grow" became "Groww". This list lets
 * the matcher recognise a word that is already English and leave it alone.
 *
 * Regular inflections (-s, -es, -ed, -ing, -ly, -er, -est, -ness) are derived
 * by `isKnownEnglishWord` in englishLexicon.ts, so only base forms and
 * irregular forms appear here. Kept as one string so the module stays small
 * and loads fast; it is split once at import.
 */
const WORDS = `
a able about above abroad absence absolute absolutely absorb abuse academic academy accept acceptable access
accident accompany accomplish according account accurate accuse achieve achievement acid acknowledge acquire
across act action active activist activity actor actress actual actually ad adapt add addition additional address
adequate adjust adjustment administration admire admission admit adopt adult advance advanced advantage adventure
advertise advertisement advertising advice advise adviser advisor advocate affair affect affordable afford afraid
after afternoon afterwards again against age agency agenda agent aggressive ago agree agreement agricultural
agriculture ahead aid aim air aircraft airline airport alarm album alcohol alert alive all allocate allocation allow
almost alone along already alright also alter alternative although always amazing ambition ambitious among amount
analysis analyst analyze analyse ancient and anger angle angry animal anniversary announce announcement annual
another answer anxiety anxious any anybody anymore anyone anything anyway anywhere apart apartment apparent
apparently appeal appear appearance apple application apply appoint appointment appreciate approach appropriate
approval approve approximately architect architecture area argue argument arise arm armed army around arrange
arrangement arrest arrival arrive art article artificial artist artistic as aside ask asleep aspect assault assess
assessment asset assign assignment assist assistance assistant associate association assume assumption assure at
athlete atmosphere attach attack attempt attend attention attitude attorney attract attractive audience audio
author authority auto automatic automatically available average avoid award aware awareness away awesome awful

baby back background bad badly bag bake balance ball ban band bank banking bar barely base baseball basic
basically basis basket bath bathroom battery battle be beach bean bear beat beautiful beauty because become bed
bedroom beer before begin beginner beginning behalf behave behavior behaviour behind being belief believe bell
belong below belt bench bend beneath benefit beside besides best bet better between beyond bicycle bid big bike
bill billion bind biological bird birth birthday bit bite bitter black blade blame blank blanket blind block blog
blood blow blue board boat body bomb bond bone bonus book booking boom boost boot border boring born borrow boss
both bother bottle bottom bounce boundary bowl box boy boyfriend brain branch brand brave bread break breakfast
breath breathe brick bridge brief briefly bright brilliant bring broad broker brother brown brush budget buddy
build building bullet bunch burden burn bury bus business busy but butter button buy buyer by bye

cabin cabinet cable cake calculate calculation calendar call calm camera camp campaign campus can cancel cancer
candidate cap capability capable capacity capital captain capture car carbon card care career careful carefully
carry case cash cast cat catch category cause caution ceiling celebrate celebration celebrity cell center centre
central century ceremony certain certainly chain chair chairman challenge chamber champion championship chance
change channel chapter character characteristic charge charity chart chase chat cheap cheat check cheek cheese
chef chemical chest chicken chief child childhood chip chocolate choice choose chrome church circle circumstance
cite citizen city civil claim clarity class classic classroom clean clear clearly clever client climate climb clinic
clip clock close closely clothes clothing cloud club clue cluster coach coal coast coat code coffee cognitive coin
cold collaborate collapse colleague collect collection collective college colonial color colour column combination
combine come comedy comfort comfortable command commander comment commercial commission commit commitment committee
common communicate communication community company compare comparison compete competition competitive competitor
complain complaint complete completely complex complicated component compose composition compound comprehensive
computer concentrate concentration concept concern concerned concert conclude conclusion concrete condition conduct
conference confidence confident confirm conflict confront confusion congratulations connect connection
consciousness consensus consequence conservative consider considerable consideration consist consistent consistency
constant constantly constitute constitutional construct construction consult consultant consume consumer
consumption contact contain container contemporary content contest context continue contract contrast contribute
contribution control controversial controversy convenient convention conventional conversation convert conviction
convince cook cookie cooking cool cooperation cop cope copy core corn corner corporate corporation correct correctly
cost cotton couch could council count counter country county couple courage course court cousin cover coverage cow
crack craft crash crazy cream create creation creative creativity creator creature credit crew crime criminal crisis
criteria critic critical criticism criticize criticise crop cross crowd crucial cruel crush cry cultural culture
cup curious currency current currently curriculum cursor curve custom customer cut cute cycle

dad daily damage dance danger dangerous dare dark darkness data database date daughter day dead deadline deal
dealer dear death debate debt decade decide decision deck declare decline decrease dedicate deep deeply defeat
defend defense defence define definitely definition degree delay delete deliver delivery demand democracy
democratic demonstrate deny department depend dependent deposit depression depth deputy derive describe
description desert deserve design designer desire desk desperate despite destroy destruction detail detect
determine develop developer development device devote dialogue diamond die diet differ difference different
differently difficult difficulty dig digital dimension dinner direct direction directly director dirt dirty
disability disadvantage disagree disappear disaster discipline discount discover discovery discrimination discuss
discussion disease dish dismiss disorder display distance distant distinct distinction distinguish distribute
distribution district diverse diversify diversification diversity divide dividend division divorce doctor document
documentary dog dollar domestic dominant dominate donate donation door dose double doubt down download downtown
dozen draft drag drama dramatic dramatically draw drawing dream dress drink drive driver drop drug dry due dull
during dust duty

each eager ear early earn earnings earth ease easily east eastern easy eat economic economics economist economy
edge edit edition editor educate education educational effect effective effectively efficiency efficient effort
egg eight either elderly elect election electric electricity electronic element elementary elephant eleven
eliminate elite else elsewhere email embrace emerge emergency emission emotion emotional emphasis emphasize employ
employee employer employment empty enable encounter encourage end enemy energy enforcement engage engagement engine
engineer engineering enhance enjoy enormous enough ensure enter enterprise entertainment entire entirely entrance
entry environment environmental episode equal equally equipment equity era error escape especially essay essential
essentially establish establishment estate estimate ethics ethnic evaluate evaluation even evening event
eventually ever every everybody everyday everyone everything everywhere evidence evil evolution evolve exact
exactly exam examination examine example exceed excellent except exception exchange excited exciting excuse
executive exercise exhibit exhibition exist existence existing exit expand expansion expect expectation expense
expensive experience experiment expert explain explanation explode explore explosion export expose exposure
express expression extend extension extensive extent external extra extraordinary extreme extremely eye

fabric face facility fact factor factory faculty fade fail failure fair fairly faith fake fall false fame familiar
family famous fan fancy fantastic far farm farmer fashion fast fat fate father fault favor favour favorite
favourite fear feature federal fee feed feedback feel feeling fellow female fence few fiber fibre fiction field
fifteen fifth fifty fight fighter figure file fill film filter final finally finance financial find finding fine
finger finish fire firm first fish fit fitness five fix flag flame flat flavor flavour flee flesh flexible flight
float floor flow flower fly focus fold folk follow food fool foot football for force forecast foreign forest
forever forget forgive form formal format formation former formula forth fortune forward found foundation founder
four fourth frame framework free freedom freeze frequency frequent frequently fresh friend friendly friendship
from front frozen fruit frustration fuel full fully fun function fund fundamental funding funeral funny furniture
furthermore future

gain galaxy gallery game gaming gang gap garage garden garlic gas gate gather gaze gear gender gene general
generally generate generation generous genetic gentle gentleman gently genuine gesture get ghost giant gift girl
girlfriend give glad glance glass global glove go goal god gold golden golf good goodbye goods government governor
grab grade gradually graduate grain grand grandfather grandmother grant graph grass grave gray grey great green
greet grocery gross ground group grow growth guarantee guard guess guest guidance guide guideline guilty gun guy

habit habitat hair half hall hand handful handle hang happen happy hard hardly harm hat hate have he head headline
headquarters health healthy hear hearing heart heat heaven heavily heavy height helicopter hell hello help helpful
her here heritage hero herself hey hi hide high highlight highly highway hill him himself hint hip hire his
historian historic historical history hit hobby hold hole holiday holy home homeless honest honestly honey honor
honour hook hope horizon horrible horror horse hospital host hot hotel hour house household housing how however
huge human humble humor humour hundred hunger hungry hunt hurry hurt husband

i ice idea ideal identification identify identity if ignore ill illegal illness illustrate image imagination
imagine immediate immediately impact implement implication imply import importance important impose impossible
impress impression impressive improve improvement in incentive incident include income incorporate increase
increasingly incredible indeed independence independent index indicate indication individual industrial industry
infant infection inflation influence influencer inform information ingredient initial initially initiative injury
inner innocent innovation input inquiry inside insight insist inspire install instance instant instead
institution instruction instructor instrument insurance intellectual intelligence intelligent intend intense
intensity intention interaction interest interesting internal international internet interpret interpretation
intervention interview into introduce introduction invasion invent invest investigate investigation investment
investor invite involve involvement iron island issue it item its itself

jacket jail jeans job join joint joke journal journalist journey joy judge judgment judgement juice jump junior
jury just justice justify

keen keep key kick kid kill kind king kiss kitchen knee knife knock know knowledge

lab label labor labour laboratory lack lady lake land landscape language lap laptop large largely last late later
latest latter laugh launch law lawn lawsuit lawyer lay layer lazy lead leader leadership leaf league lean learn
least leather leave lecture left leg legacy legal legend legislation legitimate lemon lend length less lesson let
letter level liability liberal library license licence lie life lifestyle lifetime lift light like likely limit
limitation line link lip liquid list listen literally literary literature little live living load loan local
locate location lock logic login logo lonely long look loose lose loss lot loud love lovely lover low loyal luck
lucky lunch luxury lung

machine mad magazine magic mail main mainly maintain maintenance major majority make maker makeup male mall man
manage management manager manner manual manufacture manufacturer many map margin mark market marketing marriage
married marry mask mass massive master match mate material math mathematics matter maximum may maybe mayor me meal
mean meaning meanwhile measure measurement meat mechanism media medical medicine medium meet meeting member
membership memory mental mention mentor menu mere merely merge mess message metal meter method metre middle might
mild military milk million mind mine minimum minister minor minority minute miracle mirror miss mission mistake mix
mixture mobile mode model moderate modern modest mom moment money monitor month monthly mood moon moral more
moreover morning mortgage most mostly mother motion motivate motivation motor mount mountain mouse mouth move
movement movie much multiple murder muscle museum music musical musician must mutual my myself mystery myth

name narrative narrow nation national native natural naturally nature near nearby nearly necessarily necessary
neck need negative negotiate negotiation neighbor neighbour neighborhood neighbourhood neither nerve nervous net
network never nevertheless new newly news newspaper next nice night nine no nobody nod noise none nonetheless nor
normal normally north northern nose not note nothing notice notification notion novel now nowhere nuclear number
numerous nurse nut

object objective obligation observation observe obtain obvious obviously occasion occasionally occupation occupy
occur ocean odd odds of off offence offense offensive offer office officer official often oh oil ok okay old on
once one ongoing onion online only onto open opening operate operation operator opinion opponent opportunity
oppose opposite opposition optimistic option or orange order ordinary organic organization organisation organize
organise orientation origin original originally other others otherwise ought our ourselves out outcome output
outside oven over overall overcome overlook overseas owe own owner ownership

pace pack package page pain painful paint painter painting pair pale palm pan panel panic paper parent park
parking part participant participate participation particular particularly partly partner partnership party pass
passage passenger passion passive password past patch path patience patient pattern pause pay payment peace peak
peer penalty pension people pepper per perceive percent percentage perception perfect perfectly perform
performance perhaps period permanent permission permit person personal personality personally perspective
persuade phase phenomenon philosophy phone photo photograph photographer phrase physical physically physician
piano pick picture pie piece pile pilot pin pink pipe pitch place plan plane planet plant plastic plate platform
play player please pleasure plenty plot plus pocket podcast poem poet poetry point pole police policy political
politician politics poll pollution pool poor pop popular population porch port portfolio portion portrait pose
position positive possess possibility possible possibly post pot potato potential potentially pound pour poverty
powder power powerful practical practice practise praise pray prayer precious precise precisely predict
prediction prefer preference pregnant premium preparation prepare presence present presentation preserve
president press pressure pretend pretty prevent previous previously price pride priest primarily primary prime
principal principle print prior priority prison prisoner privacy private prize probably problem procedure proceed
process produce producer product production profession professional professor profile profit profitable program
programme progress project prominent promise promote promotion prompt proof proper properly property proportion
proposal propose prospect protect protection protein protest proud prove provide provider province provision
psychological psychology public publication publicly publish publisher pull punishment purchase pure purpose
pursue push put puzzle

qualify quality quantity quarter question quick quickly quiet quietly quit quite quiz quote

race racial radical radio rail rain raise rally range rank rapid rapidly rare rarely rate rather rating ratio raw
reach react reaction read reader ready real realistic reality realize realise really reason reasonable recall
receive recent recently recipe recognition recognize recognise recommend recommendation record recover recovery
recruit red reduce reduction reel refer reference reflect reflection reform refund refuse regard regardless region
regional register regret regular regularly regulate regulation reject relate relation relationship relative
relatively relax release relevant reliable relief religion religious rely remain remarkable remember remind remote
remove rent repair repeat repeatedly replace reply report reporter represent representation representative
reputation request require requirement research researcher reserve resident resign resist resistance resolution
resolve resort resource respect respond response responsibility responsible rest restaurant restore restriction
result retail retain retire retirement return reveal revenue review revolution reward rhythm rice rich rid ride
right ring rise risk risky river road rock role roll romantic roof room root rope rose rough roughly round route
routine row royal rubber rule run rural rush

sad safe safety sake salad salary sale salt same sample sand satellite satisfaction satisfy sauce save saving
say scale scared scenario scene schedule scheme scholar scholarship school science scientific scientist scope score
scream screen script sea search season seat second secret secretary section sector secure security see seed seek
seem segment select selection self sell seller send senior sense sensitive sentence separate sequence series
serious seriously serve server service session set setting settle settlement setup seven several severe shade
shadow shake shall shape share sharp she sheet shelf shell shelter shift shine ship shirt shock shoe shoot shop
shopping shore short shortly shot should shoulder shout show shower shut shy sick side sigh sight sign signal
significance significant significantly silence silent silly silver similar similarly simple simply sin since sing
singer single sink sir sister sit site situation six size skill skin sky slave sleep slice slide slight slightly
slip slow slowly small smart smell smile smoke smooth snap snow so soccer social society soft software soil solar
soldier solid solution solve some somebody somehow someone something sometimes somewhat somewhere son song soon
sophisticated sorry sort soul sound soup source south southern space speak speaker special specialist species
specific specifically speech speed spend spending spin spirit spiritual split sponsor sport spot spread spring
square squeeze stability stable staff stage stair stake stand standard star stare start startup state statement
station statistics status stay steady steal steel step stick still stir stock stomach stone stop storage store
storm story straight strange stranger strategic strategy stream street strength strengthen stress stretch strict
strike string strip stroke strong strongly structural structure struggle student studio study stuff stupid style
subject submit subscribe subscriber subscription subsequent substance substantial succeed success successful
successfully such sudden suddenly sue suffer sufficient sugar suggest suggestion suit suitable summer summit sun
super supply support supporter suppose sure surely surface surgery surprise surround survey survival survive
suspect sustain sustainable swear sweep sweet swim swing switch symbol symptom system

table tablet tactic tail take tale talent talk tall tank tap tape target task taste tax taxi tea teach teacher
team tear technical technique technology teen teenager telephone television tell temperature temporary ten tend
tendency tennis tension tent term terrible territory terror test text than thank thanks that the theater theatre
their them theme themselves then theory therapy there therefore these they thick thin thing think third thirty
this those though thought thousand threat threaten three thrilled throat through throughout throw thumb thus
ticket tie tight till time timeline tiny tip tired tissue title to today toe together toilet token tomato tomorrow
tone tongue tonight too tool tooth top topic total totally touch tough tour tourist tournament toward towards tower
town toy trace track trade trader trading tradition traditional traffic tragedy trail train training transaction
transfer transform transformation transition translate transport transportation trap travel treat treatment
treaty tree tremendous trend trial tribe trick trip troop trouble truck true truly trust truth try tube tune
tunnel turn tutorial twelve twenty twice twin two type typical typically

ugly ultimate ultimately unable uncle under undergo understand understanding unemployment unfortunately uniform
union unique unit united universal universe university unknown unless unlike unlikely unlock until unusual up
update upgrade upload upon upper upset urban urge urgent us use useful user usual usually utility

vacation valid valley valuable valuation value variable variation variety various vary vast vegetable vehicle
venture version versus very vessel veteran via victim victory video view viewer village violate violation violence
violent viral virtual virtually virtue virus visible vision visit visitor visual vital vlog voice volatile
volatility volume volunteer vote voter vulnerable

wage wait wake walk wall wallet wander want war warm warn warning wash waste watch water wave way we weak weakness
wealth wealthy weapon wear weather web website wedding week weekend weekly weigh weight weird welcome welfare well
west western wet what whatever wheel when whenever where whereas whether which while whisper white who whole whom
whose why wide widely widespread wife wild will willing win wind window wine wing winner winter wipe wire wisdom
wise wish with withdraw within without witness woman wonder wonderful wood wooden word work worker workout workshop
world worried worry worth would wound wow wrap write writer wrong

yard yeah year yell yellow yes yesterday yet yield you young youth your yourself zero zone

am is are was were been being did does done had has made said went gone came taken took given gave got gotten
known knew seen saw thought brought bought caught taught told sold found felt kept left lost meant met paid sent
shown spent stood understood won wrote written built began begun broke broken chose chosen drove driven ate eaten
fell fallen flew flown forgot forgotten grew grown hid held hung laid led lent lit rode rang ran sang sank shook
shot shut sat slept slid spoke spoken sprang stole stuck struck swam swore threw thrown wore woke worn worse worst
children men women feet teeth mice an each anyone fewer further lots ago upon whom shall

app apps smartphone blogger vlogger influencer editing hashtag thumbnail caption captions reels shorts thread
cofounder startup fintech crypto stocks shares mutual fund funds equity bonds returns
crore crores lakh lakhs rupee rupees okay guys hey bro dude cool literally actually seriously honestly definitely
totally basically super amazing awesome brilliant financialization financialisation digitization digitisation
urbanization urbanisation premiumization formalization formalisation
`;

export const COMMON_ENGLISH_WORDS: ReadonlySet<string> = new Set(WORDS.split(/\s+/).filter(Boolean));
