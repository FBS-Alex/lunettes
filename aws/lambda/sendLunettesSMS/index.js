var AWS = require('aws-sdk');
var crypto = require('crypto');
var pinpoint = new AWS.Pinpoint({ region: process.env.region });

// Make sure the SMS channel is enabled for the projectId that you specify.
// See: https://docs.aws.amazon.com/pinpoint/latest/userguide/channels-sms-setup.html
var projectId = process.env.projectId;

var messageType = "TRANSACTIONAL";

exports.handler = (event, context, callback) => {
  console.log('Received event:', event);
  validateNumber(event.data);
};

function validateNumber(eventData) {
  var destinationNumber = eventData.phoneNumber;
  if (destinationNumber.length == 11) {
    destinationNumber = "+81" + destinationNumber;
  }
  var params = {
    NumberValidateRequest: {
      IsoCountryCode: 'JA',
      PhoneNumber: destinationNumber
    }
  };
  pinpoint.phoneNumberValidate(params, function(err, data) {
    if (err) {
      console.log(err, err.stack);
    }
    else {
      console.log(data);
      if (data['NumberValidateResponse']['PhoneTypeCode'] == 0) {
        createEndpoint(data, eventData.name, eventData.itemName, eventData.templateName, eventData.source);
      }
      else {
        console.log("Received a phone number that isn't capable of receiving " +
          "SMS messages. No endpoint created.");
      }
    }
  });
}

function createEndpoint(data, name, itemName, templateName, source) {
  var destinationNumber = data['NumberValidateResponse']['CleansedPhoneNumberE164'];
  var endpointId = data['NumberValidateResponse']['CleansedPhoneNumberE164'].substring(1) + '_' + crypto.createHash('sha256', { outputLength: 32 }).update(itemName).digest('hex');

  var params = {
    ApplicationId: projectId,
    // The Endpoint ID is equal to the cleansed phone number minus the leading
    // plus sign. This makes it easier to easily update the endpoint later.
    EndpointId: endpointId,
    EndpointRequest: {
      ChannelType: 'SMS',
      Address: destinationNumber,
      OptOut: 'NONE',
      Location: {
        PostalCode: data['NumberValidateResponse']['ZipCode'],
        City: data['NumberValidateResponse']['City'],
        Country: data['NumberValidateResponse']['CountryCodeIso2'],
      },
      Demographic: {
        Timezone: data['NumberValidateResponse']['Timezone']
      },
      Attributes: {
        Source: [
          source
        ],
        ItemName: [
          itemName
        ]
      },
      User: {
        UserAttributes: {
          Name: [
            name
          ]
        }
      }
    }
  };
  pinpoint.updateEndpoint(params, function(err, data) {
    if (err) {
      console.log(err, err.stack);
    }
    else {
      console.log(data);
      sendConfirmation(endpointId, templateName);
    }
  });
}

function sendConfirmation(endpointId, templateName) {
  var params = {
    ApplicationId: projectId,
    MessageRequest: {
      Endpoints: {
        [endpointId]: {}
      },
      MessageConfiguration: {
        SMSMessage: {
          MessageType: messageType
        }
      },
      TemplateConfiguration: {
        SMSTemplate: {
          Name: templateName
        }
      }
    }
  };

  pinpoint.sendMessages(params, function(err, data) {
    // If something goes wrong, print an error message.
    if (err) {
      console.log(err.message);
      // Otherwise, show the unique ID for the message.
    }
    else {
      console.log("Message sent! " +
        data['MessageResponse']['EndpointResult'][endpointId]['StatusMessage']);
    }
  });
}
