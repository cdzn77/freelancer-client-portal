#!/usr/bin/env python3
"""Build the downloadable guide from docs/USER-GUIDE.md (requires reportlab)."""
from pathlib import Path
import re, html, shutil
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak, Preformatted, KeepTogether
from reportlab.platypus.tableofcontents import TableOfContents
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/Freelancer-Client-Portal-Guide.pdf'
for name,file in [('WorkSans','WorkSans-Regular.ttf'),('WorkSansMedium','WorkSans-Medium.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(ROOT/'public/fonts/work-sans'/file)))
pdfmetrics.registerFontFamily('WorkSans',normal='WorkSans',bold='WorkSansMedium')
navy=colors.HexColor('#162338');blue=colors.HexColor('#2563eb');muted=colors.HexColor('#586579')
styles={
 'body':ParagraphStyle('Body',fontName='WorkSans',fontSize=10.2,leading=15.2,textColor=navy,spaceAfter=11),
 'step':ParagraphStyle('Step',fontName='WorkSans',fontSize=10.2,leading=15.2,textColor=navy,spaceAfter=8,leftIndent=17,firstLineIndent=-17),
 'chapter':ParagraphStyle('Chapter',fontName='WorkSansMedium',fontSize=24,leading=29,textColor=navy,spaceAfter=23,keepWithNext=True),
 'small':ParagraphStyle('Small',fontName='WorkSans',fontSize=9,leading=13,textColor=muted,spaceAfter=10),
 'code':ParagraphStyle('Code',fontName='Courier',fontSize=8.2,leading=12,textColor=navy,backColor=colors.HexColor('#eef2f8'),borderPadding=10,spaceBefore=7,spaceAfter=16),
 'coverTitle':ParagraphStyle('CoverTitle',fontName='WorkSansMedium',fontSize=43,leading=47,textColor=colors.white,spaceAfter=25),
 'coverSub':ParagraphStyle('CoverSub',fontName='WorkSans',fontSize=17,leading=24,textColor=colors.HexColor('#cddcff'),spaceAfter=30),
 'coverSmall':ParagraphStyle('CoverSmall',fontName='WorkSans',fontSize=11,leading=17,textColor=colors.HexColor('#cddcff'),spaceAfter=10),
}
def inline(text):
    text=html.escape(text,quote=False)
    text=re.sub(r'`([^`]+)`',lambda m:'<font name="Courier">'+m.group(1)+'</font>',text)
    text=re.sub(r'\*\*([^*]+)\*\*',r'<b>\1</b>',text)
    text=re.sub(r'(?<!["\w])(https?://[^\s<>]+)',lambda m:'<a href="'+m.group(0)+'" color="#2563eb">'+m.group(0)+'</a>',text)
    return text
class Guide(BaseDocTemplate):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs); self.current_chapter=''
    def afterFlowable(self,f):
        if getattr(f,'chapter',None):
            title,key=f.chapter;self.canv.bookmarkPage(key);self.canv.addOutlineEntry(title,key,0,False)
            self.notify('TOCEntry',(0,title,self.page,key));self.current_chapter=title

def page(canvas,doc):
    canvas.saveState();w,h=letter
    if doc.page==1:
        canvas.setFillColor(navy);canvas.rect(0,0,w,h,fill=1,stroke=0)
        canvas.setFillColor(blue);canvas.rect(54,h-82,64,6,fill=1,stroke=0)
        canvas.setFillColor(colors.HexColor('#293b57'));canvas.circle(520,105,120,fill=1,stroke=0)
        canvas.setFillColor(blue);canvas.circle(520,105,72,fill=1,stroke=0)
    else:
        canvas.setFont('WorkSansMedium',8);canvas.setFillColor(muted);canvas.drawString(54,h-32,'FREELANCER CLIENT PORTAL / USER GUIDE')
        canvas.setStrokeColor(colors.HexColor('#dce3ec'));canvas.line(54,h-42,w-54,h-42)
        canvas.line(54,44,w-54,44);canvas.setFont('WorkSans',8);canvas.drawString(54,29,'Version 0.1.0  |  November 14, 2026');canvas.drawRightString(w-54,29,str(doc.page))
    canvas.restoreState()
doc=Guide(str(OUT),pagesize=letter,leftMargin=54,rightMargin=54,topMargin=67,bottomMargin=62,title='Freelancer Client Portal: Installation and User Guide',author='Freelancer Client Portal',subject='Step-by-step installation, white-label setup, administrator and client workflows',pageCompression=1)
frame=Frame(54,62,504,663,id='content',leftPadding=0,bottomPadding=0,rightPadding=0,topPadding=0)
doc.addPageTemplates(PageTemplate(id='Guide',frames=[frame],onPage=page))
story=[Spacer(1,72),Paragraph('Freelancer<br/>Client Portal',styles['coverTitle']),Paragraph('Installation &amp;<br/>everyday use',styles['coverSub']),Paragraph('A step-by-step guide for freelancers,<br/>their teams, and their clients.',styles['coverSmall']),Spacer(1,90),Paragraph('37 chapters<br/>Version 0.1.0<br/>November 14, 2026',styles['coverSmall']),PageBreak()]
story.append(Paragraph('Contents',styles['chapter']))
story.append(Paragraph('Choose a chapter in this index or use the PDF bookmarks. Source and updates: <a href="https://github.com/cdzn77/freelancer-client-portal" color="#2563eb">GitHub repository</a>.',styles['small']))
toc=TableOfContents();toc.levelStyles=[ParagraphStyle('Index',fontName='WorkSans',fontSize=10,leading=17,textColor=navy,spaceBefore=3)];story.append(toc)
text=(ROOT/'docs/USER-GUIDE.md').read_text()
chapters=re.split(r'^## ',text,flags=re.M)[1:]
for index,section in enumerate(chapters):
    lines=section.splitlines();title=lines[0].strip();story.append(PageBreak());heading=Paragraph(inline(title),styles['chapter']);heading.chapter=(title,f'chapter-{index+1:02}');story.append(heading)
    i=1
    while i<len(lines):
        line=lines[i]
        if not line.strip():i+=1;continue
        if line.startswith('```'):
            code=[];i+=1
            while i<len(lines) and not lines[i].startswith('```'):code.append(lines[i]);i+=1
            story.append(Preformatted('\n'.join(code),styles['code'],maxLineLength=97));i+=1;continue
        buf=[line];i+=1
        while i<len(lines) and lines[i].strip() and not re.match(r'^(\d+\. |```)',lines[i]):buf.append(lines[i]);i+=1
        value=' '.join(buf)
        story.append(Paragraph(inline(value),styles['step'] if re.match(r'^\d+\. ',value) else styles['body']))
doc.multiBuild(story)
(ROOT/"public/help").mkdir(exist_ok=True)
shutil.copy2(OUT, ROOT/"public/help/guide.pdf")
print(OUT)
