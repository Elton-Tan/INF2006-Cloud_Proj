# Getting Started Reproduction and Deployment

## Before we commence:
You need to ensure you have:
NodeJs: You can download the latest version [here](https://nodejs.org/en/download)

Visual Studio Code: Download it [here](https://code.visualstudio.com/download)

> Note that when we install packages, we will use visusal studio console

> If unsure how to access VScode terminal, see top window `...` and then refer to image <img width="770" height="122" alt="image" src="https://github.com/user-attachments/assets/a5b7b835-444e-48f0-a820-4db2321447dc" />



## Start with Github
1.  Download Terraform folder and open in VSCode
   
## ScrappingBee Setup
2.  Sign up for an account in ScrappingBEE via this website: https://app.scrapingbee.com
3.  Once signup, login and you can see the API-KEY in the dashboard
4.  Open up secrets.tf and replace scrappingBEE API value with YOPUR OWN API key

## AWS Console;
5.  Install the terraform packages using `npm install terraform`
6. Now create an AWS account (it can take up to 1 day to be approved). You can create an account on AWS [here](https://aws.amazon.com/free/?trk=69d2c498-e65f-4ae8-8065-d904c8f3bd1b&sc_channel=ps&ef_id=CjwKCAiA55rJBhByEiwAFkY1QPtjhlSycUOQ9ukJL4RsAQ7FWBDyjQEcSW8a0DNCMeMmYeRc-WyJ6hoCeQUQAvD_BwE:G:s&s_kwcid=AL!4422!3!785574063566!e!!g!!aws%20sign%20in!23291341377!188768684043&gad_campaignid=23291341377&gbraid=0AAAAADjHtp-mzAioyemm068rHxftbz_SX&gclid=CjwKCAiA55rJBhByEiwAFkY1QPtjhlSycUOQ9ukJL4RsAQ7FWBDyjQEcSW8a0DNCMeMmYeRc-WyJ6hoCeQUQAvD_BwE)

### Before continuing, you should ensure your region is selected is <ins>US-EAST-1</ins>
> You can change region top-right hand corner if unsure

> <img width="412" height="75" alt="image" src="https://github.com/user-attachments/assets/93804862-9df2-4e0b-b039-dbcaa0038f1d" />



7. Go to IAM and retrieve the AWS access key by clicking on your user, your root account. It should like something like `AKIAXXXXXXXXXXXXXXXXXX`
8. Install aws package using `npm install aws`
9. Set the access key in your terraform profile using `aws configure`
10. Initiate Terraform using the command `terraform init` and call `terraform validate`
11. Now `Terraform Apply`
> Step 11 can take up to 15 minutes to be completed... please be patient

## Testing the Frontend
12. Once all the services are set up, go back to Visual Studio Code and look for a folder called build
13. Go back to AWS console and go to S3 bucket by searching on the console
14. Create a bucket by clicking <img width="91" height="30" alt="image" src="https://github.com/user-attachments/assets/67bfc3cb-e586-4fc6-a5cf-2966eed7d106" />
, and upload the whole build folder into the S3. 
> For step 14, you may leave the other settings as default, unless you have other settings in mind

15. Once complete, navigate to AWS cloudfront and attach a cloudfront to the S3 bucket <ins>(note the URL after attachment)</ins>
> Step 15 just checks whether the frontend is okay - you will realise the functionality is not working. If you can see a frontend by opening the url, this step is passed :)
16. Go to secrets manager again, you will see a secret facebook_app_id and instagram_app_id. We need to replace this

## Set up Meta Developer
17. Go to [Meta Developer Page](https://developers.facebook.com/)
18. Sign up for an account
19. Create a Use case, and select manage everything on your page and manage messaging and content on instagram
20. Once created, go to Tools > Graph API explorer
21. assign permission for pages_show_list, instagram_basic, instagram_content_publish, pages_read_engagement and pages_manage_posts
22. click generate access token then generate page token
23. Replace the page token in your secrets for facebook and instagram respectively

## Back to AWS Console - Amazon Q Business
24. click on create app
25. Once created, attach the agent_knowledge_base as the knowledge S3 (go to integrations and select S3)
26. Select <ins>**SINGLE**</ins> availability index (also known as Starter index)
> Enterprise index is DOUBLE the cost. I do not recommend unless you require extremely high availability and scaling
27. <ins>DO NOT</ins> select anonymous access. Select the $3 subscription model (if not u will be charged $200) - when prompted, create a new user and give it a username
28. Now go to <img width="300" height="25" alt="image" src="https://github.com/user-attachments/assets/483d2e83-0615-4c68-96b3-05f6bd965c16" /> from the console
. U can see the username as such:
<img width="1385" height="114" alt="image" src="https://github.com/user-attachments/assets/8c494870-1799-4c45-a3b7-01c23280a7d9" />

> Note down the username and password. You may need to set up 2FA when doing this. Please follow the instruction on the screen if prompted. 

29. Now when u visit the app, to access Amazon Q, u will provide the login details (click on chat bubble > it will prompt login > login with the details)


30. Once everything is working, copy your Amazon Q URL by going back to Amazon Q Business page, clicking on your created app and note the deployed url under web settings url such as this:
<img width="341" height="112" alt="image" src="https://github.com/user-attachments/assets/2d189dce-3f86-4ad6-ae97-4b847f8871e9" />

> Use your own URL. Above image is only for reference

31. Go under the file config.ts
32. replace the Q_URL variable with your own Amazon Q URL

## AWS Console - API Gateway
33. Go back to amazon console and go to API gateway
34. Select the one with protocol HTTP, such as:
<img width="797" height="82" alt="image" src="https://github.com/user-attachments/assets/e905ff24-0c64-4571-923a-1efc52f1883f" />

31 copy the URL and replace API_BASE url with your own in config.ts
32 now go to websocket (the one with protocol websocket) and replace WS_BASE with your own url
35. Finally, replace for redirectUri, replace that variable with the URL u obtained in step 15

## Back to Vscode Console
36. In the console, run `npm start build`
37. You now have a new build folder
38. Go to the S3 bucket u created in step 14
39. replace the old build folder with new one just by re uploading it


## Cognito
40. Navigate to cognito
41. A userpool is created via terraform but u need to create a user
42. Click on the userpool
43. Select User
44. Select create user and choose an email and password
45. Once okay, revisit the URL in step 11
46. Login with ur newly created acc
47. U shud now see the webpage
