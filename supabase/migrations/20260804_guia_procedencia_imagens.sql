-- ============================================================================
-- Guia do Vendedor — procedência real de cada imagem.
--
-- O seed inicial gravou fonte_url genérico ("commons.wikimedia.org") e
-- url_original nulo. O dado exato já existia no _fotos.json do projeto antigo:
-- a URL do ARQUIVO no Commons e a página da obra de onde veio. Sem isso, o
-- crédito no card é uma afirmação que ninguém consegue conferir.
--
-- Não mexe nas 8 reprovadas: elas não têm arquivo e não devem ganhar procedência.
-- ============================================================================

update public.guia_imagens set
  url_original = case slug
  when 'nelore' then 'https://upload.wikimedia.org/wikipedia/commons/f/f0/Ocasi%C3%A3o_da_SH_e_Batuque_do_R.I..jpg'
  when 'angus' then 'https://upload.wikimedia.org/wikipedia/commons/6/66/Angus_cattle_18.jpg'
  when 'brahman' then 'https://upload.wikimedia.org/wikipedia/commons/3/3e/Brahman_%28EMAPA%29_110307_REFON_2.jpg'
  when 'senepol' then 'https://upload.wikimedia.org/wikipedia/commons/3/3c/Toro_25M.jpg'
  when 'canchim' then 'https://upload.wikimedia.org/wikipedia/commons/5/54/Touro_Canchim_REFON.jpg'
  when 'guzera' then 'https://upload.wikimedia.org/wikipedia/commons/e/ed/Guzer%C3%A1_macho_-_EMAPA_100307_REFON_1.jpg'
  when 'confinamento' then 'https://upload.wikimedia.org/wikipedia/commons/d/d3/Full_Blood_Wagyu_Bull_in_Chile.jpg'
  when 'girolando' then 'https://upload.wikimedia.org/wikipedia/commons/e/e1/Meio-sangue.jpg'
  when 'holandes' then 'https://upload.wikimedia.org/wikipedia/commons/b/b8/Holstein_Cow_in_Mont%C3%A9r%C3%A9gie%2C_Quebec.jpg'
  when 'gir-leiteiro' then 'https://upload.wikimedia.org/wikipedia/commons/e/e6/Gir_bull_2.jpg'
  when 'jersey' then 'https://upload.wikimedia.org/wikipedia/commons/6/6b/Cute_Jersey_Cow.jpg'
  when 'pardo-suico' then 'https://upload.wikimedia.org/wikipedia/commons/e/e9/Brown_swiss.jpg'
  when 'mestica-pasto' then 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Bezerros_Girolando_Pastando.jpg'
  when 'isa-brown' then 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Isa_cs_layers_brownJPG.jpg'
  when 'lohmann-brown' then 'https://upload.wikimedia.org/wikipedia/commons/f/f8/Lohmann_Brown_adult_hen_in_homebird-yard_02.jpg'
  when 'white-leghorn' then 'https://upload.wikimedia.org/wikipedia/commons/6/62/Leghorn_cockerel_and_hen.jpg'
  when 'pescoco-pelado' then 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Galo_caipira_pesco%C3%A7o_pelado_-_IMG_0521.jpg'
  when 'paraiso-pedres' then 'https://upload.wikimedia.org/wikipedia/commons/7/72/Sophia_and_ZsuZsu_walking_the_property.jpg'
  when 'landrace' then 'https://upload.wikimedia.org/wikipedia/commons/7/7d/American_Landrace_Boar.jpg'
  when 'large-white' then 'https://upload.wikimedia.org/wikipedia/commons/0/0c/Large_White_pigs_%28Belagro-2021%29_2.jpg'
  when 'duroc' then 'https://upload.wikimedia.org/wikipedia/commons/1/1f/20231102_-_Rouxbio_-_09_%28cropped%29.jpg'
  when 'pietrain' then 'https://upload.wikimedia.org/wikipedia/commons/9/98/Pi%C3%A9train.jpg'
  when 'suinos-terminacao' then 'https://upload.wikimedia.org/wikipedia/commons/1/15/Landrace_pig_%28Belagro-2021%29.jpg'
  when 'milho' then 'https://upload.wikimedia.org/wikipedia/commons/0/07/Corn_grains.JPG'
  when 'farelo-soja' then 'https://upload.wikimedia.org/wikipedia/commons/e/e3/Soybean_Meal_%2810059014026%29.jpg'
  when 'sorgo' then 'https://upload.wikimedia.org/wikipedia/commons/8/84/Sorghum_bicolor03.jpg'
  when 'farelo-trigo' then 'https://upload.wikimedia.org/wikipedia/commons/8/84/Triticum_aestivum_bran%2C_tarwe_zemelen.jpg'
  when 'caroco-algodao' then 'https://upload.wikimedia.org/wikipedia/commons/9/9a/Cotton_seeds_-_01.jpg'
  when 'raspa-mandioca' then 'https://upload.wikimedia.org/wikipedia/commons/6/6c/Drying_cassava_chips_DRC.jpg'
  when 'calcario-calcitico' then 'https://upload.wikimedia.org/wikipedia/commons/3/36/Agricultural_lime_in_field._Lime_pile.jpg'
  when 'sal-comum' then 'https://upload.wikimedia.org/wikipedia/commons/7/78/Kosher_Salt.JPG'
  when 'sal-mineral' then 'https://upload.wikimedia.org/wikipedia/commons/a/a4/Cattle_at_Salt_Lick_on_Wildcat_Creek_%285553744545%29.jpg'
  when 'oleo-soja' then 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Soybean_Oil_%2810059657806%29.jpg'
  when 'ureia' then 'https://upload.wikimedia.org/wikipedia/commons/7/70/Sample_of_Urea.jpg'
  when 'silagem-milho' then 'https://upload.wikimedia.org/wikipedia/commons/9/9a/Feldpausch_Farms_005_%28Large%29.jpg'
  when 'palma-forrageira' then 'https://upload.wikimedia.org/wikipedia/commons/d/d4/Dikenli_%C4%B0ncir_%28Opuntia_ficus-indica%29_Gaziantep_Turkey.IMG_1104.jpg'
  end,
  fonte_url = case slug
  when 'nelore' then 'https://pt.wikipedia.org/wiki/Nelore'
  when 'angus' then 'https://pt.wikipedia.org/wiki/Angus_(ra%C3%A7a_bovina)'
  when 'brahman' then 'https://en.wikipedia.org/wiki/Brahman_cattle'
  when 'senepol' then 'https://pt.wikipedia.org/wiki/Senepol'
  when 'canchim' then 'https://pt.wikipedia.org/wiki/Canchim'
  when 'guzera' then 'https://pt.wikipedia.org/wiki/Guzer%C3%A1'
  when 'confinamento' then 'https://commons.wikimedia.org/wiki/File:Full_Blood_Wagyu_Bull_in_Chile.jpg'
  when 'girolando' then 'https://pt.wikipedia.org/wiki/Girolando'
  when 'holandes' then 'https://en.wikipedia.org/wiki/Holstein_Friesian_cattle'
  when 'gir-leiteiro' then 'https://en.wikipedia.org/wiki/Gyr_cattle'
  when 'jersey' then 'https://commons.wikimedia.org/wiki/File:Cute_Jersey_Cow.jpg'
  when 'pardo-suico' then 'https://en.wikipedia.org/wiki/Brown_Swiss_cattle'
  when 'mestica-pasto' then 'https://commons.wikimedia.org/wiki/File:Bezerros_Girolando_Pastando.jpg'
  when 'isa-brown' then 'https://commons.wikimedia.org/wiki/File:Isa_cs_layers_brownJPG.jpg'
  when 'lohmann-brown' then 'https://commons.wikimedia.org/wiki/File:Lohmann_Brown_adult_hen_in_homebird-yard_02.jpg'
  when 'white-leghorn' then 'https://commons.wikimedia.org/wiki/File:Leghorn_cockerel_and_hen.jpg'
  when 'pescoco-pelado' then 'https://commons.wikimedia.org/wiki/File:Galo_caipira_pesco%C3%A7o_pelado_-_IMG_0521.jpg'
  when 'paraiso-pedres' then 'https://commons.wikimedia.org/wiki/File:Sophia_and_ZsuZsu_walking_the_property.jpg'
  when 'landrace' then 'https://commons.wikimedia.org/wiki/File:American_Landrace_Boar.jpg'
  when 'large-white' then 'https://commons.wikimedia.org/wiki/File:Large_White_pigs_(Belagro-2021)_2.jpg'
  when 'duroc' then 'https://commons.wikimedia.org/wiki/File:20231102_-_Rouxbio_-_09_(cropped).jpg'
  when 'pietrain' then 'https://commons.wikimedia.org/wiki/File:Pi%C3%A9train.jpg'
  when 'suinos-terminacao' then 'https://commons.wikimedia.org/wiki/File:Landrace_pig_(Belagro-2021).jpg'
  when 'milho' then 'https://commons.wikimedia.org/wiki/File:Corn_grains.JPG'
  when 'farelo-soja' then 'https://commons.wikimedia.org/wiki/File:Soybean_Meal_(10059014026).jpg'
  when 'sorgo' then 'https://commons.wikimedia.org/wiki/File:Sorghum_bicolor03.jpg'
  when 'farelo-trigo' then 'https://commons.wikimedia.org/wiki/File:Triticum_aestivum_bran,_tarwe_zemelen.jpg'
  when 'caroco-algodao' then 'https://commons.wikimedia.org/wiki/File:Cotton_seeds_-_01.jpg'
  when 'raspa-mandioca' then 'https://commons.wikimedia.org/wiki/File:Drying_cassava_chips_DRC.jpg'
  when 'calcario-calcitico' then 'https://commons.wikimedia.org/wiki/File:Agricultural_lime_in_field._Lime_pile.jpg'
  when 'sal-comum' then 'https://commons.wikimedia.org/wiki/File:Kosher_Salt.JPG'
  when 'sal-mineral' then 'https://commons.wikimedia.org/wiki/File:Cattle_at_Salt_Lick_on_Wildcat_Creek_(5553744545).jpg'
  when 'oleo-soja' then 'https://commons.wikimedia.org/wiki/File:Soybean_Oil_(10059657806).jpg'
  when 'ureia' then 'https://commons.wikimedia.org/wiki/File:Sample_of_Urea.jpg'
  when 'silagem-milho' then 'https://commons.wikimedia.org/wiki/File:Feldpausch_Farms_005_(Large).jpg'
  when 'palma-forrageira' then 'https://commons.wikimedia.org/wiki/File:Dikenli_%C4%B0ncir_(Opuntia_ficus-indica)_Gaziantep_Turkey.IMG_1104.jpg'
  end
where status <> 'reprovada' and slug in (

  'nelore',
  'angus',
  'brahman',
  'senepol',
  'canchim',
  'guzera',
  'confinamento',
  'girolando',
  'holandes',
  'gir-leiteiro',
  'jersey',
  'pardo-suico',
  'mestica-pasto',
  'isa-brown',
  'lohmann-brown',
  'white-leghorn',
  'pescoco-pelado',
  'paraiso-pedres',
  'landrace',
  'large-white',
  'duroc',
  'pietrain',
  'suinos-terminacao',
  'milho',
  'farelo-soja',
  'sorgo',
  'farelo-trigo',
  'caroco-algodao',
  'raspa-mandioca',
  'calcario-calcitico',
  'sal-comum',
  'sal-mineral',
  'oleo-soja',
  'ureia',
  'silagem-milho',
  'palma-forrageira'
);
